import { Env } from "../types";
import { verifyAnonymousIdentityToken, verifyDeviceIdentityToken } from "../lib/anonymous-identity";
import { checkRateLimit, checkMessageLength, checkBannedWords, getChannelPasscodeInfo } from "../lib/validation";
import { deleteMediaByUrl } from "../lib/media";
import { attachUploadTicket, deleteUploadTicketByAttachment } from "../lib/upload-tickets";
import { authorizeRoomToken } from "./passcode";

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
  if (request.method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const { nick, text, channel_id, image, upload_id, reply_to, report, reported_msg_id } = body;

    if (!channel_id) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Internal proxy authentication alone does not grant channel-owner rights.
    // Ownership is verified against the target channel below.
    const internalToken = request.headers.get("X-Internal-Token");
    const verifiedUserId = request.headers.get("X-User-Id");
    const hasVerifiedIdentity = internalToken === env.INTERNAL_SECRET && !!verifiedUserId;

    // Passcode gate — check if channel requires passcode for writing
    const isLiveChannel = (channel_id as string).endsWith("_live");
    const parentChannelId = isLiveChannel ? (channel_id as string).replace(/_live$/, "") : channel_id as string;
    const channel = await env.DB.prepare(`
      SELECT id, is_frozen, owner_uid, passcode,
        (SELECT is_frozen FROM channels WHERE id = ?) AS target_is_frozen
      FROM channels
      WHERE id = ?
    `).bind(channel_id, parentChannelId).first();
    if (!channel) return Response.json({ error: "channel not found" }, { status: 404 });
    const isChannelOwner = hasVerifiedIdentity && (channel as any).owner_uid === verifiedUserId;

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
    const isTargetFrozen = isLiveChannel
      ? (channel as any).target_is_frozen
      : (channel as any).is_frozen;
    if (isTargetFrozen && !isChannelOwner) {
      return Response.json({ error: "channel frozen" }, { status: 403 });
    }

    const anonymousUid = isChannelOwner ? null : await getAnonymousRequesterUid(request, env);
    const requesterDeviceId = isChannelOwner ? null : await getRequesterDeviceId(request, env);
    if (!isChannelOwner && !anonymousUid) {
      return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
    }
    if (!isChannelOwner && !requesterDeviceId) {
      return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
    }
    const requesterUid = isChannelOwner ? verifiedUserId! : anonymousUid!;

    // Rate limit check
    if (!checkRateLimit(requesterUid)) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }

    // Message length check
    if (text && !checkMessageLength(text as string)) {
      return Response.json({ error: "message_too_long" }, { status: 400 });
    }

    // These are independent read-only checks. Run them together only after
    // passcode, freeze, rate-limit and length validation have succeeded.
    const [blocked, allowedByBannedWords] = await Promise.all([
      env.DB.prepare("SELECT 1 FROM blocked WHERE (uid = ? OR fingerprint = ?) AND channel_id = ?")
        .bind(requesterUid, requesterDeviceId || "", parentChannelId).first(),
      text
        ? checkBannedWords(text as string, parentChannelId, env)
        : Promise.resolve(true),
    ]);
    if (blocked) return Response.json({ error: "blocked" }, { status: 403 });

    if (!allowedByBannedWords) {
      return Response.json({ error: "banned_word" }, { status: 403 });
    }

    // Insert message (+ gallery if image) in a single batch
    const id = crypto.randomUUID();
    if (image) {
      if (typeof upload_id !== "string" || !upload_id) {
        return Response.json({ error: "invalid_upload_ticket" }, { status: 400 });
      }
      const attachment = await attachUploadTicket({
        env,
        ticketId: upload_id,
        imageUrl: image as string,
        channelId: channel_id as string,
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
        INSERT INTO messages (id, uid, auth_uid, nick, text, is_admin, channel_id, image, reply_to, fingerprint, report, reported_msg_id, gallery_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, senderUid, senderUid, nick || null, text || "", isAdmin, channel_id, image || null, reply_to || null, requesterDeviceId || null, report ? 1 : 0, reported_msg_id || null, image ? id : null, created_at),
    ];
    if (image) {
      stmts.push(
        env.DB.prepare("INSERT INTO gallery (id, image, auth_uid, channel_id, created_at) VALUES (?, ?, ?, ?, ?)")
          .bind(id, image, senderUid, channel_id, created_at)
      );
    }
    await env.DB.batch(stmts);

    // Broadcast via Durable Object
    // For live channels, only broadcast to the parent channel's DO (where clients connect)
    const broadcastChannelId = (channel_id as string).endsWith("_live")
      ? (channel_id as string).replace(/_live$/, "")
      : channel_id as string;
    const newMessage = {
      id, uid: senderUid, auth_uid: senderUid, nick: nick || null, text: text || "", is_admin: isAdmin,
      channel_id, image: image || null, reply_to: reply_to || null, fingerprint: requesterDeviceId || null,
      report: report ? 1 : 0, reported_msg_id: reported_msg_id || null, gallery_id: image ? id : null,
      deleted: 0, edited: 0, reactions: "{}", created_at,
    };
    const doId = env.CHAT_ROOM.idFromName(broadcastChannelId);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "message-new", message: newMessage }),
    }));

    return Response.json({ id, created_at });
  }

  // DELETE — hard delete (remove message) or soft delete (mark as deleted)
  if (request.method === "DELETE") {
    const body = await request.json() as Record<string, unknown>;
    const { message_id, channel_id, soft } = body;

    if (!message_id || !channel_id) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Passcode gate
    const delParent = (channel_id as string).endsWith("_live") ? (channel_id as string).replace(/_live$/, "") : channel_id as string;
    const { passcode: delPasscode } = await getChannelPasscodeInfo(delParent, env);
    if (delPasscode) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
      const decoded = await authorizeRoomToken(roomToken, delParent, delPasscode, env);
      if (!decoded) {
        return Response.json({ error: "invalid token" }, { status: 403 });
      }
    }

    const requesterUid = await getAnonymousRequesterUid(request, env);
    if (!requesterUid) {
      return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
    }

    // Verify ownership
    const msg = await env.DB.prepare("SELECT uid, image FROM messages WHERE id = ? AND channel_id = ?")
      .bind(message_id, channel_id).first();
    if (!msg) return Response.json({ error: "not found" }, { status: 404 });
    if (msg.uid !== requesterUid) return Response.json({ error: "not owner" }, { status: 403 });

    if (soft) {
      // Keep the reply placeholder, but remove its media from both collections.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM gallery WHERE id = ? AND channel_id = ?")
          .bind(message_id, channel_id),
        env.DB.prepare("UPDATE messages SET deleted = 1, text = '삭제된 채팅입니다', image = NULL, gallery_id = NULL WHERE id = ? AND channel_id = ?")
          .bind(message_id, channel_id),
      ]);
    } else {
      // Hard delete — remove the message and its gallery entry together.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM gallery WHERE id = ? AND channel_id = ?")
          .bind(message_id, channel_id),
        env.DB.prepare("DELETE FROM messages WHERE id = ? AND channel_id = ?")
          .bind(message_id, channel_id),
      ]);
    }
    await deleteMediaByUrl(env, msg.image as string | null | undefined);
    await deleteUploadTicketByAttachment(env, "message", message_id as string);

    // Broadcast deletion with payload
    const broadcastChannelId = (channel_id as string).endsWith("_live")
      ? (channel_id as string).replace(/_live$/, "")
      : channel_id as string;
    const doId = env.CHAT_ROOM.idFromName(broadcastChannelId);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "message-deleted", message_id, soft: !!soft }),
    }));

    return Response.json({ ok: true });
  }

  // PUT — edit message
  if (request.method === "PUT") {
    const body = await request.json() as Record<string, unknown>;
    const { message_id, channel_id, text } = body;

    if (!message_id || !channel_id || typeof text !== "string") {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    const internalToken = request.headers.get("X-Internal-Token");
    const verifiedUserId = request.headers.get("X-User-Id");
    const hasVerifiedIdentity = internalToken === env.INTERNAL_SECRET && !!verifiedUserId;

    // Passcode gate
    const isLiveChannel = (channel_id as string).endsWith("_live");
    const editParent = isLiveChannel ? (channel_id as string).replace(/_live$/, "") : channel_id as string;
    const channel = await env.DB.prepare(`
      SELECT id, is_frozen, owner_uid, passcode,
        (SELECT is_frozen FROM channels WHERE id = ?) AS target_is_frozen
      FROM channels
      WHERE id = ?
    `).bind(channel_id, editParent).first();
    if (!channel) return Response.json({ error: "channel not found" }, { status: 404 });
    const isChannelOwner = hasVerifiedIdentity && (channel as any).owner_uid === verifiedUserId;

    if ((channel as any).passcode && !isChannelOwner) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
      const decoded = await authorizeRoomToken(roomToken, editParent, (channel as any).passcode, env);
      if (!decoded) {
        return Response.json({ error: "invalid token" }, { status: 403 });
      }
    }

    const isTargetFrozen = isLiveChannel
      ? (channel as any).target_is_frozen
      : (channel as any).is_frozen;
    if (isTargetFrozen && !isChannelOwner) {
      return Response.json({ error: "channel frozen" }, { status: 403 });
    }

    const anonymousUid = isChannelOwner ? null : await getAnonymousRequesterUid(request, env);
    const requesterDeviceId = isChannelOwner ? null : await getRequesterDeviceId(request, env);
    if (!isChannelOwner && !anonymousUid) {
      return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
    }
    if (!isChannelOwner && !requesterDeviceId) {
      return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
    }
    const requesterUid = isChannelOwner ? verifiedUserId! : anonymousUid!;

    if (!checkRateLimit(requesterUid)) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }

    if (!checkMessageLength(text)) {
      return Response.json({ error: "message_too_long" }, { status: 400 });
    }

    const [blocked, allowedByBannedWords] = await Promise.all([
      env.DB.prepare("SELECT 1 FROM blocked WHERE (uid = ? OR fingerprint = ?) AND channel_id = ?")
        .bind(requesterUid, requesterDeviceId || "", editParent).first(),
      checkBannedWords(text, editParent, env),
    ]);
    if (blocked) return Response.json({ error: "blocked" }, { status: 403 });
    if (!allowedByBannedWords) {
      return Response.json({ error: "banned_word" }, { status: 403 });
    }

    // Verify ownership
    const msg = await env.DB.prepare("SELECT uid FROM messages WHERE id = ? AND channel_id = ?")
      .bind(message_id, channel_id).first();
    if (!msg) return Response.json({ error: "not found" }, { status: 404 });
    if (msg.uid !== requesterUid) return Response.json({ error: "not owner" }, { status: 403 });

    await env.DB.prepare("UPDATE messages SET text = ?, edited = 1 WHERE id = ?")
      .bind(text, message_id).run();

    // Broadcast edit with payload
    const broadcastChannelId = (channel_id as string).endsWith("_live")
      ? (channel_id as string).replace(/_live$/, "")
      : channel_id as string;
    const doId = env.CHAT_ROOM.idFromName(broadcastChannelId);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "message-edited", message_id, text, edited: true }),
    }));

    return Response.json({ ok: true });
  }

  // PATCH — toggle reaction
  if (request.method === "PATCH") {
    const body = await request.json() as Record<string, unknown>;
    const { message_id, channel_id, emoji } = body;

    if (!message_id || !channel_id || !emoji) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Passcode gate
    const patchParent = (channel_id as string).endsWith("_live") ? (channel_id as string).replace(/_live$/, "") : channel_id as string;
    const internalToken = request.headers.get("X-Internal-Token");
    const verifiedUserId = request.headers.get("X-User-Id");
    const isVerifiedAdmin = internalToken === env.INTERNAL_SECRET && !!verifiedUserId;
    if (isVerifiedAdmin) {
      const channel = await env.DB.prepare("SELECT owner_uid FROM channels WHERE id = ?")
        .bind(patchParent).first();
      if (!channel || channel.owner_uid !== verifiedUserId) {
        return Response.json({ error: "not owner" }, { status: 403 });
      }
    }
    const { passcode: patchPasscode } = await getChannelPasscodeInfo(patchParent, env);
    if (patchPasscode && !isVerifiedAdmin) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
      const decoded = await authorizeRoomToken(roomToken, patchParent, patchPasscode, env);
      if (!decoded) {
        return Response.json({ error: "invalid token" }, { status: 403 });
      }
    }
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
      const blocked = await env.DB.prepare(
        "SELECT 1 FROM blocked WHERE (uid = ? OR fingerprint = ?) AND channel_id = ? LIMIT 1"
      ).bind(reactionUid, requesterDeviceId || "", patchParent).first();
      if (blocked) return Response.json({ error: "blocked" }, { status: 403 });
    }

    // Get current reactions
    const msg = await env.DB.prepare("SELECT reactions FROM messages WHERE id = ? AND channel_id = ?")
      .bind(message_id, channel_id).first() as { reactions: string } | null;
    if (!msg) return Response.json({ error: "not found" }, { status: 404 });

    const reactions: Record<string, string> = JSON.parse(msg.reactions || "{}");
    const key = `${reactionUid}_${(emoji as string).codePointAt(0)?.toString(16)}`;

    // Toggle: if exists remove, otherwise add
    if (reactions[key]) {
      delete reactions[key];
    } else {
      reactions[key] = emoji as string;
    }

    await env.DB.prepare("UPDATE messages SET reactions = ? WHERE id = ?")
      .bind(JSON.stringify(reactions), message_id).run();

    // Broadcast reaction change with payload (no full refetch needed)
    const broadcastChannelId = (channel_id as string).endsWith("_live")
      ? (channel_id as string).replace(/_live$/, "")
      : channel_id as string;
    const doId = env.CHAT_ROOM.idFromName(broadcastChannelId);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "reaction-changed", message_id, reactions: JSON.stringify(reactions) }),
    }));

    return Response.json({ ok: true, reactions });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}
