import type { Env } from "../types.ts";
import { verifyAnonymousIdentityToken, verifyDeviceIdentityToken } from "../lib/anonymous-identity.ts";
import { getChannelModeration, isOwnerModerationBlocked } from "../lib/channel-moderation.ts";
import { isReportsChannel } from "../lib/special-channels.ts";
import { checkMessageLength, checkBannedWords, getChannelPasscodeInfo } from "../lib/validation.ts";
import { deleteMediaByUrl } from "../lib/media.ts";
import { attachUploadTicket, deleteUploadTicketByAttachment } from "../lib/upload-tickets.ts";
import { endLiveSession, isLiveSessionExpired, readLiveSessionState } from "../lib/live-sessions.ts";
import { hashBlockedDeviceId, isBlockedActor } from "../lib/actor-identities.ts";
import { syncMessageLink } from "../lib/message-links.ts";
import { withOperationalErrorContext } from "../lib/operational-events.ts";
import { authorizeRoomToken } from "./passcode.ts";
import { isValidClientMessageId } from "../lib/message-idempotency.ts";
import { normalizeRequestedReplyId, resolveReplyRootId } from "../lib/message-threads.ts";

const MESSAGE_RATE_LIMIT_WINDOW_MS = 10_000;
const MESSAGE_RATE_LIMIT_MAX = 5;

async function getAnonymousRequesterUid(request: Request, env: Env): Promise<string | null> {
  const token = request.headers.get("X-Anonymous-Token");
  if (!token) return null;
  const payload = await verifyAnonymousIdentityToken(token, env);
  return payload?.uid || null;
}

async function getRequesterDeviceId(request: Request, env: Env): Promise<string | null> {
  const token = request.headers.get("X-Device-Token");
  if (!token) return null;
  const payload = await verifyDeviceIdentityToken(token, env);
  return payload?.device_id || null;
}

export async function handleMessages(request: Request, env: Env): Promise<Response> {
  const routeAction = request.method === "POST"
    ? "send"
    : request.method === "DELETE"
      ? "delete"
      : request.method === "PUT"
        ? "edit"
        : request.method === "PATCH"
          ? "reaction"
          : "unknown";
  let routeStage = "dispatch";
  let requestChannelId: string | null = null;
  let parentChannelId: string | null = null;
  let liveChannel = false;

  try {
    if (request.method === "POST") {
      routeStage = "parse_body";
      const body = await request.json() as Record<string, unknown>;
      const { client_message_id, nick, text, channel_id, image, upload_id, reply_to, report, reported_msg_id } = body;

      if (!channel_id) {
        return Response.json({ error: "missing required fields" }, { status: 400 });
      }
      requestChannelId = String(channel_id);
      if (client_message_id !== undefined && !isValidClientMessageId(client_message_id)) {
        return Response.json({ error: "invalid_client_message_id" }, { status: 400 });
      }
      const requestedReplyTo = normalizeRequestedReplyId(reply_to);
      if (requestedReplyTo === undefined) {
        return Response.json({ error: "invalid_reply_target" }, { status: 400 });
      }
      const requestedReportedMessageId = report
        ? normalizeRequestedReplyId(reported_msg_id)
        : null;
      if (report && !requestedReportedMessageId) {
        return Response.json({ error: "invalid_report_target" }, { status: 400 });
      }
      const clientMessageId = isValidClientMessageId(client_message_id) ? client_message_id : crypto.randomUUID();

      // Internal proxy authentication alone does not grant channel-owner rights.
      // Ownership is verified against the target channel below.
      const internalToken = request.headers.get("X-Internal-Token");
      const verifiedUserId = request.headers.get("X-User-Id");
      const hasVerifiedIdentity = internalToken === env.INTERNAL_SECRET && !!verifiedUserId;

      // Passcode gate — check if channel requires passcode for writing
      liveChannel = requestChannelId.endsWith("_live");
      parentChannelId = liveChannel ? requestChannelId.replace(/_live$/, "") : requestChannelId;
      if (liveChannel) {
        routeStage = "load_live_state";
        const liveSession = await readLiveSessionState(env, parentChannelId);
        if (!liveSession || isLiveSessionExpired(liveSession)) {
          if (liveSession) {
            routeStage = "expire_live_state";
            await endLiveSession(env, parentChannelId, "expired", liveSession.sessionId);
          }
          return Response.json({ error: "live_session_ended" }, { status: 403 });
        }
      }
      routeStage = "load_channel_state";
      const channel = await env.DB.prepare(`
        SELECT id, is_frozen, owner_uid, passcode,
          (SELECT is_frozen FROM channels WHERE id = ?) AS target_is_frozen
        FROM channels
        WHERE id = ?
      `).bind(requestChannelId, parentChannelId).first();
      if (!channel) return Response.json({ error: "channel not found" }, { status: 404 });
      const isChannelOwner = hasVerifiedIdentity && (channel as any).owner_uid === verifiedUserId;
      if (isChannelOwner) {
        routeStage = "load_owner_moderation";
        const moderation = await getChannelModeration(parentChannelId, env);
        if (isOwnerModerationBlocked(moderation)) {
          return Response.json({ error: "owner_suspended" }, { status: 403 });
        }
      }
      routeStage = "verify_channel_access";
      if (isReportsChannel(parentChannelId, env) && !isChannelOwner) {
        return Response.json({ error: "owner access required" }, { status: 403 });
      }

      routeStage = "verify_room_access";
      if ((channel as any).passcode && !isChannelOwner) {
        const roomToken = request.headers.get("X-Room-Token");
        if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
        const decoded = await authorizeRoomToken(roomToken, parentChannelId, (channel as any).passcode, env);
        if (!decoded) {
          return Response.json({ error: "invalid token" }, { status: 403 });
        }
      }

      // The target channel's freeze state is fetched with the parent channel,
      // avoiding a second D1 round trip for live messages.
      const isTargetFrozen = liveChannel
        ? (channel as any).target_is_frozen
        : (channel as any).is_frozen;
      if (isTargetFrozen && !isChannelOwner) {
        return Response.json({ error: "channel frozen" }, { status: 403 });
      }

      routeStage = "resolve_actor_identity";
      const anonymousUid = isChannelOwner ? null : await getAnonymousRequesterUid(request, env);
      const requesterDeviceId = isChannelOwner ? null : await getRequesterDeviceId(request, env);
      if (!isChannelOwner && !anonymousUid) {
        return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
      }
      if (!isChannelOwner && !requesterDeviceId) {
        return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
      }
      const requesterUid = isChannelOwner ? verifiedUserId! : anonymousUid!;

      routeStage = "check_idempotency";
      const existingMessage = await env.DB.prepare(
        "SELECT id, uid, channel_id, created_at FROM messages WHERE client_message_id = ? LIMIT 1"
      ).bind(clientMessageId).first<{ id: string; uid: string; channel_id: string; created_at: string }>();
      if (existingMessage) {
        if (existingMessage.uid !== requesterUid || existingMessage.channel_id !== requestChannelId) {
          return Response.json({ error: "client_message_id_conflict" }, { status: 409 });
        }
        return Response.json({ id: existingMessage.id, created_at: existingMessage.created_at, duplicate: true });
      }

      routeStage = "apply_rate_limit";
      const doId = env.CHAT_ROOM.idFromName(parentChannelId);
      const chatRoom = env.CHAT_ROOM.get(doId);
      const messageRateLimitResponse = await chatRoom.fetch(new Request("http://internal/channel-rate-limit", {
        method: "POST",
        body: JSON.stringify({
          scope: "message-send",
          subjectKey: `${requesterUid}:${requesterDeviceId || "owner"}`,
          limit: MESSAGE_RATE_LIMIT_MAX,
          windowMs: MESSAGE_RATE_LIMIT_WINDOW_MS,
        }),
      }));
      if (!messageRateLimitResponse.ok) {
        return Response.json({ error: "rate_limit_unavailable" }, { status: 503 });
      }
      const messageRateLimit = await messageRateLimitResponse.json() as { ok: boolean };
      if (!messageRateLimit.ok) {
        return Response.json({ error: "rate_limited" }, { status: 429 });
      }

      routeStage = "validate_message_content";
      if (text && !checkMessageLength(text as string)) {
        return Response.json({ error: "message_too_long" }, { status: 400 });
      }

      routeStage = "check_block_and_banned_words";
      const [blocked, allowedByBannedWords] = await Promise.all([
        isBlockedActor({
          env,
          channelId: parentChannelId,
          uid: requesterUid,
          deviceId: requesterDeviceId,
        }),
        text
          ? checkBannedWords(text as string, parentChannelId, env)
          : Promise.resolve(true),
      ]);
      if (blocked) return Response.json({ error: "blocked" }, { status: 403 });

      if (!allowedByBannedWords) {
        return Response.json({ error: "banned_word" }, { status: 403 });
      }

      routeStage = "resolve_reply_target";
      const resolvedReplyTo = requestedReplyTo
        ? await resolveReplyRootId(env, requestChannelId, requestedReplyTo)
        : null;
      if (requestedReplyTo && !resolvedReplyTo) {
        return Response.json({ error: "invalid_reply_target" }, { status: 400 });
      }
      routeStage = "resolve_report_target";
      const resolvedReportedMessage = requestedReportedMessageId
        ? await env.DB.prepare(
          "SELECT id FROM messages WHERE id = ? AND channel_id = ? AND deleted = 0"
        ).bind(requestedReportedMessageId, requestChannelId).first<{ id: string }>()
        : null;
      if (requestedReportedMessageId && !resolvedReportedMessage) {
        return Response.json({ error: "invalid_report_target" }, { status: 400 });
      }
      const resolvedReportedMessageId = resolvedReportedMessage?.id || null;

      // Insert message (+ gallery if image) in a single batch
      const id = crypto.randomUUID();
      if (image) {
        routeStage = "attach_upload_ticket";
        if (typeof upload_id !== "string" || !upload_id) {
          return Response.json({ error: "invalid_upload_ticket" }, { status: 400 });
        }
        const attachment = await attachUploadTicket({
          env,
          ticketId: upload_id,
          imageUrl: image as string,
          channelId: requestChannelId,
          purpose: "message",
          uid: isChannelOwner ? null : requesterUid,
          authUid: isChannelOwner ? requesterUid : null,
          attachedRecordId: id,
        });
        if (!attachment.ok) {
          return Response.json({ error: attachment.error }, { status: 400 });
        }
      }
      // D1's datetime('now') default has only second precision. Persist an
      // explicit millisecond timestamp so consecutive photo messages keep their
      // original order after reconnecting.
      const created_at = new Date().toISOString();
      // Only a verified owner is stored and broadcast as the channel admin.
      const senderUid = requesterUid;
      const isAdmin = isChannelOwner ? 1 : 0;
      const stmts = [
        env.DB.prepare(`
          INSERT INTO messages (id, client_message_id, uid, auth_uid, nick, text, is_admin, channel_id, image, reply_to, report, reported_msg_id, gallery_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, clientMessageId, senderUid, senderUid, nick || null, text || "", isAdmin, requestChannelId, image || null, resolvedReplyTo, report ? 1 : 0, resolvedReportedMessageId, image ? id : null, created_at),
      ];
      if (!isChannelOwner && requesterDeviceId) {
        routeStage = "persist_message_identities";
        const deviceIdHash = await hashBlockedDeviceId(requesterDeviceId, env);
        stmts.push(
          env.DB.prepare(
            `INSERT OR REPLACE INTO message_actor_identities
              (record_id, record_type, channel_id, uid, device_id_hash, created_at)
             VALUES (?, 'message', ?, ?, ?, ?)`
          ).bind(id, parentChannelId, senderUid, deviceIdHash, created_at)
        );
      }
      if (image) {
        stmts.push(
          env.DB.prepare("INSERT INTO gallery (id, image, auth_uid, channel_id, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(id, image, senderUid, requestChannelId, created_at)
        );
      }
      routeStage = "persist_message_batch";
      try {
        await env.DB.batch(stmts);
      } catch (error) {
        routeStage = "resolve_batch_conflict";
        const duplicate = await env.DB.prepare(
          "SELECT id, uid, channel_id, created_at FROM messages WHERE client_message_id = ? LIMIT 1"
        ).bind(clientMessageId).first<{ id: string; uid: string; channel_id: string; created_at: string }>();
        if (duplicate?.uid === requesterUid && duplicate.channel_id === requestChannelId) {
          return Response.json({ id: duplicate.id, created_at: duplicate.created_at, duplicate: true });
        }
        throw error;
      }
      routeStage = "sync_message_links";
      await syncMessageLink(env, id, requestChannelId, created_at, text as string | undefined);

      // Broadcast through the same parent-channel Durable Object used above.
      const newMessage = {
        id, uid: senderUid, auth_uid: senderUid, nick: nick || null, text: text || "", is_admin: isAdmin,
        channel_id, image: image || null, reply_to: resolvedReplyTo,
        report: report ? 1 : 0, reported_msg_id: resolvedReportedMessageId, gallery_id: image ? id : null,
        deleted: 0, edited: 0, reactions: "{}", created_at,
      };
      routeStage = "broadcast_message";
      await chatRoom.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "message-new", message: newMessage }),
      }));

      routeStage = "build_response";
      return Response.json({ id, created_at });
    }

    // DELETE — hard delete (remove message) or soft delete (mark as deleted)
    if (request.method === "DELETE") {
      routeStage = "parse_body";
      const body = await request.json() as Record<string, unknown>;
      const { message_id, channel_id, soft } = body;

      if (!message_id || !channel_id) {
        return Response.json({ error: "missing required fields" }, { status: 400 });
      }
      requestChannelId = String(channel_id);
      parentChannelId = requestChannelId.endsWith("_live") ? requestChannelId.replace(/_live$/, "") : requestChannelId;
      liveChannel = requestChannelId.endsWith("_live");

      routeStage = "verify_channel_access";
      if (isReportsChannel(parentChannelId, env)) {
        const internalToken = request.headers.get("X-Internal-Token");
        const verifiedUserId = request.headers.get("X-User-Id");
        const reportChannel = internalToken === env.INTERNAL_SECRET && verifiedUserId
          ? await env.DB.prepare("SELECT owner_uid FROM channels WHERE id = ?")
            .bind(parentChannelId).first<{ owner_uid: string }>()
          : null;
        if (!reportChannel || reportChannel.owner_uid !== verifiedUserId) {
          return Response.json({ error: "owner access required" }, { status: 403 });
        }
      }
      routeStage = "verify_room_access";
      const { passcode: delPasscode } = await getChannelPasscodeInfo(parentChannelId, env);
      if (delPasscode) {
        const roomToken = request.headers.get("X-Room-Token");
        if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
        const decoded = await authorizeRoomToken(roomToken, parentChannelId, delPasscode, env);
        if (!decoded) {
          return Response.json({ error: "invalid token" }, { status: 403 });
        }
      }

      routeStage = "resolve_actor_identity";
      const requesterUid = await getAnonymousRequesterUid(request, env);
      if (!requesterUid) {
        return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
      }

      routeStage = "load_message_owner";
      const msg = await env.DB.prepare("SELECT uid, image FROM messages WHERE id = ? AND channel_id = ?")
        .bind(message_id, requestChannelId).first();
      if (!msg) return Response.json({ error: "not found" }, { status: 404 });
      if (msg.uid !== requesterUid) return Response.json({ error: "not owner" }, { status: 403 });

      if (soft) {
        routeStage = "soft_delete_message";
        await env.DB.batch([
          env.DB.prepare("DELETE FROM gallery WHERE id = ? AND channel_id = ?")
            .bind(message_id, requestChannelId),
          env.DB.prepare("DELETE FROM message_links WHERE message_id = ?")
            .bind(message_id),
          env.DB.prepare("DELETE FROM message_actor_identities WHERE record_id = ? AND record_type = 'message'")
            .bind(message_id),
          env.DB.prepare("UPDATE messages SET deleted = 1, text = '삭제된 채팅입니다', image = NULL, gallery_id = NULL WHERE id = ? AND channel_id = ?")
            .bind(message_id, requestChannelId),
        ]);
      } else {
        routeStage = "hard_delete_message";
        await env.DB.batch([
          env.DB.prepare("DELETE FROM gallery WHERE id = ? AND channel_id = ?")
            .bind(message_id, requestChannelId),
          env.DB.prepare("DELETE FROM message_links WHERE message_id = ?")
            .bind(message_id),
          env.DB.prepare("DELETE FROM message_actor_identities WHERE record_id = ? AND record_type = 'message'")
            .bind(message_id),
          env.DB.prepare("DELETE FROM messages WHERE id = ? AND channel_id = ?")
            .bind(message_id, requestChannelId),
        ]);
      }
      routeStage = "delete_message_media";
      await deleteMediaByUrl(env, msg.image as string | null | undefined);
      await deleteUploadTicketByAttachment(env, "message", message_id as string);

      routeStage = "broadcast_delete";
      const doId = env.CHAT_ROOM.idFromName(parentChannelId);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "message-deleted", message_id, soft: !!soft }),
      }));

      routeStage = "build_response";
      return Response.json({ ok: true });
    }

    // PUT — edit message
    if (request.method === "PUT") {
      routeStage = "parse_body";
      const body = await request.json() as Record<string, unknown>;
      const { message_id, channel_id, text } = body;

      if (!message_id || !channel_id || typeof text !== "string") {
        return Response.json({ error: "missing required fields" }, { status: 400 });
      }
      requestChannelId = String(channel_id);

      const internalToken = request.headers.get("X-Internal-Token");
      const verifiedUserId = request.headers.get("X-User-Id");
      const hasVerifiedIdentity = internalToken === env.INTERNAL_SECRET && !!verifiedUserId;

      // Passcode gate
      liveChannel = requestChannelId.endsWith("_live");
      parentChannelId = liveChannel ? requestChannelId.replace(/_live$/, "") : requestChannelId;
      routeStage = "load_channel_state";
      const channel = await env.DB.prepare(`
        SELECT id, is_frozen, owner_uid, passcode,
          (SELECT is_frozen FROM channels WHERE id = ?) AS target_is_frozen
        FROM channels
        WHERE id = ?
      `).bind(requestChannelId, parentChannelId).first();
      if (!channel) return Response.json({ error: "channel not found" }, { status: 404 });
      const isChannelOwner = hasVerifiedIdentity && (channel as any).owner_uid === verifiedUserId;
      if (isChannelOwner) {
        routeStage = "load_owner_moderation";
        const moderation = await getChannelModeration(parentChannelId, env);
        if (isOwnerModerationBlocked(moderation)) {
          return Response.json({ error: "owner_suspended" }, { status: 403 });
        }
      }
      routeStage = "verify_channel_access";
      if (isReportsChannel(parentChannelId, env) && !isChannelOwner) {
        return Response.json({ error: "owner access required" }, { status: 403 });
      }

      routeStage = "verify_room_access";
      if ((channel as any).passcode && !isChannelOwner) {
        const roomToken = request.headers.get("X-Room-Token");
        if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
        const decoded = await authorizeRoomToken(roomToken, parentChannelId, (channel as any).passcode, env);
        if (!decoded) {
          return Response.json({ error: "invalid token" }, { status: 403 });
        }
      }

      const isTargetFrozen = liveChannel
        ? (channel as any).target_is_frozen
        : (channel as any).is_frozen;
      if (isTargetFrozen && !isChannelOwner) {
        return Response.json({ error: "channel frozen" }, { status: 403 });
      }

      routeStage = "resolve_actor_identity";
      const anonymousUid = isChannelOwner ? null : await getAnonymousRequesterUid(request, env);
      const requesterDeviceId = isChannelOwner ? null : await getRequesterDeviceId(request, env);
      if (!isChannelOwner && !anonymousUid) {
        return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
      }
      if (!isChannelOwner && !requesterDeviceId) {
        return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
      }
      const requesterUid = isChannelOwner ? verifiedUserId! : anonymousUid!;

      routeStage = "apply_rate_limit";
      const doId = env.CHAT_ROOM.idFromName(parentChannelId);
      const chatRoom = env.CHAT_ROOM.get(doId);
      const editRateLimitResponse = await chatRoom.fetch(new Request("http://internal/channel-rate-limit", {
        method: "POST",
        body: JSON.stringify({
          scope: "message-edit",
          subjectKey: `${requesterUid}:${requesterDeviceId || "owner"}`,
          limit: MESSAGE_RATE_LIMIT_MAX,
          windowMs: MESSAGE_RATE_LIMIT_WINDOW_MS,
        }),
      }));
      if (!editRateLimitResponse.ok) {
        return Response.json({ error: "rate_limit_unavailable" }, { status: 503 });
      }
      const editRateLimit = await editRateLimitResponse.json() as { ok: boolean };
      if (!editRateLimit.ok) {
        return Response.json({ error: "rate_limited" }, { status: 429 });
      }

      routeStage = "validate_message_content";
      if (!checkMessageLength(text)) {
        return Response.json({ error: "message_too_long" }, { status: 400 });
      }

      routeStage = "check_block_and_banned_words";
      const [blocked, allowedByBannedWords] = await Promise.all([
        isBlockedActor({
          env,
          channelId: parentChannelId,
          uid: requesterUid,
          deviceId: requesterDeviceId,
        }),
        checkBannedWords(text, parentChannelId, env),
      ]);
      if (blocked) return Response.json({ error: "blocked" }, { status: 403 });
      if (!allowedByBannedWords) {
        return Response.json({ error: "banned_word" }, { status: 403 });
      }

      routeStage = "load_message_owner";
      const msg = await env.DB.prepare("SELECT uid, created_at FROM messages WHERE id = ? AND channel_id = ?")
        .bind(message_id, requestChannelId).first<{ uid: string; created_at: string }>();
      if (!msg) return Response.json({ error: "not found" }, { status: 404 });
      if (msg.uid !== requesterUid) return Response.json({ error: "not owner" }, { status: 403 });

      routeStage = "update_message_text";
      await env.DB.prepare("UPDATE messages SET text = ?, edited = 1 WHERE id = ?")
        .bind(text, message_id).run();
      routeStage = "sync_message_links";
      await syncMessageLink(env, message_id as string, requestChannelId, msg.created_at, text);

      routeStage = "broadcast_edit";
      await chatRoom.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "message-edited", message_id, text, edited: true }),
      }));

      routeStage = "build_response";
      return Response.json({ ok: true });
    }

    // PATCH — toggle reaction
    if (request.method === "PATCH") {
      routeStage = "parse_body";
      const body = await request.json() as Record<string, unknown>;
      const { message_id, channel_id, emoji } = body;

      if (!message_id || !channel_id || !emoji) {
        return Response.json({ error: "missing required fields" }, { status: 400 });
      }
      requestChannelId = String(channel_id);

      parentChannelId = requestChannelId.endsWith("_live") ? requestChannelId.replace(/_live$/, "") : requestChannelId;
      liveChannel = requestChannelId.endsWith("_live");
      const internalToken = request.headers.get("X-Internal-Token");
      const verifiedUserId = request.headers.get("X-User-Id");
      const isVerifiedAdmin = internalToken === env.INTERNAL_SECRET && !!verifiedUserId;
      routeStage = "verify_channel_access";
      if (isReportsChannel(parentChannelId, env)) {
        const reportChannel = isVerifiedAdmin
          ? await env.DB.prepare("SELECT owner_uid FROM channels WHERE id = ?")
            .bind(parentChannelId).first<{ owner_uid: string }>()
          : null;
        if (!reportChannel || reportChannel.owner_uid !== verifiedUserId) {
          return Response.json({ error: "owner access required" }, { status: 403 });
        }
      }
      if (isVerifiedAdmin) {
        routeStage = "load_channel_state";
        const channel = await env.DB.prepare("SELECT owner_uid FROM channels WHERE id = ?")
          .bind(parentChannelId).first();
        if (!channel || channel.owner_uid !== verifiedUserId) {
          return Response.json({ error: "not owner" }, { status: 403 });
        }
        routeStage = "load_owner_moderation";
        const moderation = await getChannelModeration(parentChannelId, env);
        if (isOwnerModerationBlocked(moderation)) {
          return Response.json({ error: "owner_suspended" }, { status: 403 });
        }
      }
      routeStage = "verify_room_access";
      const { passcode: patchPasscode } = await getChannelPasscodeInfo(parentChannelId, env);
      if (patchPasscode && !isVerifiedAdmin) {
        const roomToken = request.headers.get("X-Room-Token");
        if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
        const decoded = await authorizeRoomToken(roomToken, parentChannelId, patchPasscode, env);
        if (!decoded) {
          return Response.json({ error: "invalid token" }, { status: 403 });
        }
      }
      routeStage = "resolve_actor_identity";
      const anonymousUid = isVerifiedAdmin ? null : await getAnonymousRequesterUid(request, env);
      const requesterDeviceId = isVerifiedAdmin ? null : await getRequesterDeviceId(request, env);
      if (!isVerifiedAdmin && !anonymousUid) {
        return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
      }
      if (!isVerifiedAdmin && !requesterDeviceId) {
        return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
      }
      const reactionUid = isVerifiedAdmin ? verifiedUserId! : anonymousUid!;
      if (!isVerifiedAdmin) {
        routeStage = "check_block_status";
        const blocked = await isBlockedActor({
          env,
          channelId: parentChannelId,
          uid: reactionUid,
          deviceId: requesterDeviceId,
        });
        if (blocked) return Response.json({ error: "blocked" }, { status: 403 });
      }

      routeStage = "load_reactions";
      const msg = await env.DB.prepare("SELECT reactions FROM messages WHERE id = ? AND channel_id = ?")
        .bind(message_id, requestChannelId).first() as { reactions: string } | null;
      if (!msg) return Response.json({ error: "not found" }, { status: 404 });

      const reactions: Record<string, string> = JSON.parse(msg.reactions || "{}");
      const key = `${reactionUid}_${(emoji as string).codePointAt(0)?.toString(16)}`;

      if (reactions[key]) {
        delete reactions[key];
      } else {
        reactions[key] = emoji as string;
      }

      routeStage = "persist_reactions";
      await env.DB.prepare("UPDATE messages SET reactions = ? WHERE id = ?")
        .bind(JSON.stringify(reactions), message_id).run();

      routeStage = "broadcast_reaction";
      const doId = env.CHAT_ROOM.idFromName(parentChannelId);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "reaction-changed", message_id, reactions: JSON.stringify(reactions) }),
      }));

      routeStage = "build_response";
      return Response.json({ ok: true, reactions });
    }

    return Response.json({ error: "method not allowed" }, { status: 405 });
  } catch (error) {
    throw withOperationalErrorContext(error, {
      route_action: routeAction,
      route_stage: routeStage,
      request_channel_id: requestChannelId,
      channel_id: parentChannelId || requestChannelId,
      live_channel: liveChannel,
    });
  }
}
