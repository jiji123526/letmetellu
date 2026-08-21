import type { Env } from "../types.ts";
import { verifyAnonymousIdentityToken, verifyDeviceIdentityToken } from "../lib/anonymous-identity.ts";
import { getReportsChannelOwnerId, isReportsChannel } from "../lib/special-channels.ts";
import { prepareAcceptedImageQuotaConsumption } from "../lib/image-quota.ts";
import { attachUploadTicket } from "../lib/upload-tickets.ts";
import { checkBannedWords, checkMessageLength, getChannelPasscodeInfo } from "../lib/validation.ts";
import { ensureActiveLiveSession } from "../lib/live-sessions.ts";
import { hashBlockedDeviceId, isBlockedActor } from "../lib/actor-identities.ts";
import { authorizeRoomToken } from "./passcode.ts";
import { isValidClientMessageId } from "../lib/message-idempotency.ts";
import { readDmThreads } from "../lib/dm-threads.ts";
import { getTrustedAuthenticatedUserId, getTrustedUserId } from "../lib/trusted-identity.ts";
import { getChannelModeration, isOwnerModerationBlocked } from "../lib/channel-moderation.ts";
import { deleteMediaByUrl } from "../lib/media.ts";
import { deleteUploadTicketByAttachment } from "../lib/upload-tickets.ts";
import { parseMediaDimensions } from "../lib/media-dimensions.ts";

const PETITION_PREFIXES = ["[Appeal]", "[이의 제기]"];
const DM_RATE_LIMIT_WINDOW_MS = 10_000;
const DM_RATE_LIMIT_MAX = 5;
const DM_REPLY_LIMIT = 20;

interface DmRoot {
  id: string;
  client_message_id: string | null;
  uid: string;
  auth_uid: string | null;
  nick: string | null;
  text: string;
  image: string | null;
  image_w: number | null;
  image_h: number | null;
  channel_id: string;
  created_at: string;
}

function serializeDmRoot(dm: DmRoot) {
  return {
    ...dm,
    is_admin: 0,
    reactions: "{}",
    reply_to: null,
    dm: true,
  };
}

function serializeDmReply(reply: {
  id: string;
  client_reply_id: string;
  dm_id: string;
  channel_id: string;
  owner_uid: string;
  text: string;
  image: string | null;
  image_w: number | null;
  image_h: number | null;
  created_at: string;
}) {
  return {
    id: reply.id,
    client_message_id: reply.client_reply_id,
    uid: reply.owner_uid,
    auth_uid: reply.owner_uid,
    nick: null,
    text: reply.text,
    is_admin: 1,
    image: reply.image,
    image_w: reply.image_w,
    image_h: reply.image_h,
    reactions: "{}",
    reply_to: reply.dm_id,
    channel_id: reply.channel_id,
    created_at: reply.created_at,
    dm: true,
    dm_reply: true,
  };
}

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

export async function handleDm(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const channelId = url.searchParams.get("channel") || "";
    if (!channelId) return Response.json({ error: "missing channel" }, { status: 400 });

    const parentChannelId = channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
    const { exists, passcode, owner_uid } = await getChannelPasscodeInfo(parentChannelId, env);
    if (!exists) return Response.json({ error: "channel not found" }, { status: 404 });
    const trustedUserId = getTrustedUserId(request, env);
    const isOwner = trustedUserId === owner_uid;
    if (isReportsChannel(parentChannelId, env) && !isOwner) {
      return Response.json({ error: "owner access required" }, { status: 403 });
    }
    if (passcode && !isOwner) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken || !await authorizeRoomToken(roomToken, parentChannelId, passcode, env)) {
        return Response.json({ error: "passcode required" }, { status: 403 });
      }
    }

    const requesterUid = await getAnonymousRequesterUid(request, env);
    if (!isOwner && !requesterUid) {
      return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
    }
    const dm = await readDmThreads(
      env,
      channelId,
      isOwner ? { owner: true } : { owner: false, anonymousUid: requesterUid! },
    );
    const protectedUid = await getReportsChannelOwnerId(env);
    return Response.json({
      dm: dm.map((message) => (
        message.uid === "system-moderation"
        || message.uid === protectedUid
        || message.auth_uid === protectedUid
          ? { ...message, protected_sender: true }
          : message
      )),
    });
  }

  if (request.method === "PUT") {
    const trustedUserId = getTrustedUserId(request, env);
    if (!trustedUserId) return Response.json({ error: "owner access required" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    const dmId = typeof body.dm_id === "string" ? body.dm_id : "";
    const clientReplyId = typeof body.client_reply_id === "string" ? body.client_reply_id : "";
    const rawText = typeof body.text === "string" ? body.text : "";
    const image = typeof body.image === "string" ? body.image : "";
    const uploadId = typeof body.upload_id === "string" ? body.upload_id : "";
    const mediaDimensions = parseMediaDimensions(body);
    if (mediaDimensions === undefined || (!image && mediaDimensions)) {
      return Response.json({ error: "invalid_media_dimensions" }, { status: 400 });
    }
    if (
      !dmId
      || !isValidClientMessageId(clientReplyId)
      || (!rawText.trim() && !image)
      || (body.image !== undefined && typeof body.image !== "string")
    ) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }
    if (rawText && !checkMessageLength(rawText)) {
      return Response.json({ error: "message_too_long" }, { status: 400 });
    }
    if (image && !uploadId) {
      return Response.json({ error: "invalid_upload_ticket" }, { status: 400 });
    }

    const dm = await env.DB.prepare(`
      SELECT dm.id, dm.channel_id, channels.owner_uid
      FROM dm
      JOIN channels ON channels.id = CASE
        WHEN dm.channel_id LIKE '%_live' THEN substr(dm.channel_id, 1, length(dm.channel_id) - 5)
        ELSE dm.channel_id
      END
      WHERE dm.id = ? AND dm.pending_delete_at IS NULL
      LIMIT 1
    `).bind(dmId).first<{ id: string; channel_id: string; owner_uid: string }>();
    if (!dm) return Response.json({ error: "dm not found" }, { status: 404 });
    if (dm.owner_uid !== trustedUserId) {
      return Response.json({ error: "owner access required" }, { status: 403 });
    }
    const parentChannelId = dm.channel_id.endsWith("_live")
      ? dm.channel_id.replace(/_live$/, "")
      : dm.channel_id;
    const moderation = await getChannelModeration(parentChannelId, env);
    if (isOwnerModerationBlocked(moderation)) {
      return Response.json({ error: "owner_suspended" }, { status: 403 });
    }
    if (rawText && !await checkBannedWords(rawText, parentChannelId, env)) {
      return Response.json({ error: "banned_word" }, { status: 403 });
    }

    const existing = await env.DB.prepare(`
      SELECT id, client_reply_id, dm_id, channel_id, owner_uid, text, image, image_w, image_h, created_at
      FROM dm_replies
      WHERE owner_uid = ? AND client_reply_id = ?
      LIMIT 1
    `).bind(trustedUserId, clientReplyId).first<{
      id: string;
      client_reply_id: string;
      dm_id: string;
      channel_id: string;
      owner_uid: string;
      text: string;
      image: string | null;
      image_w: number | null;
      image_h: number | null;
      created_at: string;
    }>();
    if (existing) {
      if (existing.dm_id !== dmId) {
        return Response.json({ error: "client_reply_id_conflict" }, { status: 409 });
      }
      return Response.json({
        ok: true,
        duplicate: true,
        reply: serializeDmReply(existing),
      });
    }

    const chatRoom = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(parentChannelId));
    const rateLimitResponse = await chatRoom.fetch(new Request("http://internal/channel-rate-limit", {
      method: "POST",
      body: JSON.stringify({
        scope: "dm-reply",
        subjectKey: trustedUserId,
        limit: DM_RATE_LIMIT_MAX,
        windowMs: DM_RATE_LIMIT_WINDOW_MS,
      }),
    }));
    if (!rateLimitResponse.ok) {
      return Response.json({ error: "rate_limit_unavailable" }, { status: 503 });
    }
    const rateLimit = await rateLimitResponse.json() as { ok: boolean };
    if (!rateLimit.ok) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const imageQuotaConsumption = image
      ? await prepareAcceptedImageQuotaConsumption(env, {
          authenticatedUserId: trustedUserId,
          channelId: dm.channel_id,
          recordType: "dm_reply",
          recordId: id,
          now: createdAt,
        })
      : null;
    if (imageQuotaConsumption && !imageQuotaConsumption.ok) {
      const status = imageQuotaConsumption.error === "image_quota_identity_missing" ? 401 : 403;
      return Response.json({ error: imageQuotaConsumption.error }, { status });
    }
    let result: D1Result;
    try {
      result = await env.DB.prepare(`
        INSERT INTO dm_replies (id, client_reply_id, dm_id, channel_id, owner_uid, text, image, image_w, image_h, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM dm_replies
          WHERE dm_id = ?
          ORDER BY created_at ASC, id ASC
          LIMIT 1 OFFSET ?
        )
      `).bind(
        id,
        clientReplyId,
        dmId,
        dm.channel_id,
        trustedUserId,
        rawText,
        image || null,
        mediaDimensions?.width ?? null,
        mediaDimensions?.height ?? null,
        createdAt,
        dmId,
        DM_REPLY_LIMIT - 1,
      ).run();
    } catch (error) {
      const duplicate = await env.DB.prepare(`
        SELECT id, client_reply_id, dm_id, channel_id, owner_uid, text, image, image_w, image_h, created_at
        FROM dm_replies
        WHERE owner_uid = ? AND client_reply_id = ?
        LIMIT 1
      `).bind(trustedUserId, clientReplyId).first<{
        id: string;
        client_reply_id: string;
        dm_id: string;
        channel_id: string;
        owner_uid: string;
        text: string;
        image: string | null;
        image_w: number | null;
        image_h: number | null;
        created_at: string;
      }>();
      if (duplicate?.dm_id === dmId) {
        return Response.json({ ok: true, duplicate: true, reply: serializeDmReply(duplicate) });
      }
      throw error;
    }
    if ((result.meta.changes || 0) === 0) {
      return Response.json({ error: "dm_reply_limit" }, { status: 409 });
    }
    if (image) {
      const attachment = await attachUploadTicket({
        env,
        ticketId: uploadId,
        imageUrl: image,
        channelId: dm.channel_id,
        purpose: "dm",
        uid: null,
        authUid: trustedUserId,
        attachedRecordId: id,
      });
      if (!attachment.ok) {
        await env.DB.prepare("DELETE FROM dm_replies WHERE id = ?").bind(id).run();
        return Response.json({ error: attachment.error }, { status: 400 });
      }
    }
    if (imageQuotaConsumption?.statement) {
      await imageQuotaConsumption.statement.run();
    }

    await chatRoom.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "dm-threads-changed" }),
    }));
    return Response.json({
      ok: true,
      reply: serializeDmReply({
        id,
        client_reply_id: clientReplyId,
        dm_id: dmId,
        channel_id: dm.channel_id,
        owner_uid: trustedUserId,
        text: rawText,
        image: image || null,
        image_w: mediaDimensions?.width ?? null,
        image_h: mediaDimensions?.height ?? null,
        created_at: createdAt,
      }),
    });
  }

  if (request.method === "DELETE") {
    const body = await request.json() as Record<string, unknown>;
    const dmId = typeof body.dm_id === "string" ? body.dm_id : "";
    const channelId = typeof body.channel_id === "string" ? body.channel_id : "";
    if (!dmId || !channelId) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    const parentChannelId = channelId.endsWith("_live")
      ? channelId.replace(/_live$/, "")
      : channelId;
    const { exists, passcode } = await getChannelPasscodeInfo(parentChannelId, env);
    if (!exists) return Response.json({ error: "channel not found" }, { status: 404 });
    if (isReportsChannel(parentChannelId, env)) {
      return Response.json({ error: "owner access required" }, { status: 403 });
    }
    if (passcode) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken || !await authorizeRoomToken(roomToken, parentChannelId, passcode, env)) {
        return Response.json({ error: "passcode required" }, { status: 403 });
      }
    }

    const requesterUid = await getAnonymousRequesterUid(request, env);
    if (!requesterUid) {
      return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
    }
    const dm = await env.DB.prepare(
      "SELECT id, image FROM dm WHERE id = ? AND channel_id = ? AND uid = ? AND pending_delete_at IS NULL LIMIT 1"
    ).bind(dmId, channelId, requesterUid).first<{ id: string; image: string | null }>();
    if (!dm) return Response.json({ error: "dm not found" }, { status: 404 });

    const replyRows = await env.DB.prepare(
      "SELECT id, image FROM dm_replies WHERE dm_id = ?"
    ).bind(dmId).all<{ id: string; image: string | null }>();
    const replies = replyRows.results || [];
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM message_actor_identities WHERE record_id = ? AND record_type = 'dm'"
      ).bind(dmId),
      env.DB.prepare("DELETE FROM dm_replies WHERE dm_id = ?").bind(dmId),
      env.DB.prepare("DELETE FROM dm WHERE id = ? AND channel_id = ? AND uid = ?")
        .bind(dmId, channelId, requesterUid),
    ]);
    await Promise.all([
      deleteMediaByUrl(env, dm.image),
      deleteUploadTicketByAttachment(env, "dm", dmId),
      ...replies.map((reply) => deleteMediaByUrl(env, reply.image)),
      ...replies.map((reply) => deleteUploadTicketByAttachment(env, "dm", reply.id)),
    ]);

    const chatRoom = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(parentChannelId));
    await chatRoom.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "dm-deleted", dm_id: dmId }),
    }));
    await chatRoom.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "dm-threads-changed" }),
    }));
    return Response.json({ ok: true });
  }

  if (request.method === "POST") {
    const trustedAuthenticatedUserId = getTrustedAuthenticatedUserId(request, env);
    const body = await request.json() as Record<string, unknown>;
    const { client_message_id, nick, text, channel_id, image, upload_id } = body;
    const mediaDimensions = parseMediaDimensions(body);

    if (typeof channel_id !== "string" || !channel_id) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }
    if (nick !== undefined && typeof nick !== "string") {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }
    if (image !== undefined && typeof image !== "string") {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }
    if (mediaDimensions === undefined || (!image && mediaDimensions)) {
      return Response.json({ error: "invalid_media_dimensions" }, { status: 400 });
    }
    if (client_message_id !== undefined && !isValidClientMessageId(client_message_id)) {
      return Response.json({ error: "invalid_client_message_id" }, { status: 400 });
    }
    const clientMessageId = isValidClientMessageId(client_message_id) ? client_message_id : crypto.randomUUID();
    if (text !== undefined && typeof text !== "string") {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }
    const rawText = typeof text === "string" ? text : "";
    const trimmedText = rawText.trim();
    if (!trimmedText && !image) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Passcode gate
    const isLiveChannel = (channel_id as string).endsWith("_live");
    const parentChannelId = isLiveChannel ? (channel_id as string).replace(/_live$/, "") : channel_id as string;
    if (isLiveChannel) {
      if (!await ensureActiveLiveSession(env, parentChannelId)) {
        return Response.json({ error: "live_session_ended" }, { status: 403 });
      }
    }
    if (isReportsChannel(parentChannelId, env)) {
      return Response.json({ error: "owner access required" }, { status: 403 });
    }
    const { exists, passcode } = await getChannelPasscodeInfo(parentChannelId, env);
    if (!exists) return Response.json({ error: "channel not found" }, { status: 404 });
    if (passcode) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
      const decoded = await authorizeRoomToken(roomToken, parentChannelId, passcode, env);
      if (!decoded) {
        return Response.json({ error: "invalid token" }, { status: 403 });
      }
    }

    const requesterUid = await getAnonymousRequesterUid(request, env);
    const requesterDeviceId = await getRequesterDeviceId(request, env);
    if (!requesterUid) {
      return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
    }
    if (!requesterDeviceId) {
      return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
    }

    const existingDm = await env.DB.prepare(
      "SELECT * FROM dm WHERE client_message_id = ? LIMIT 1"
    ).bind(clientMessageId).first<DmRoot>();
    if (existingDm) {
      if (existingDm.uid !== requesterUid || existingDm.channel_id !== channel_id) {
        return Response.json({ error: "client_message_id_conflict" }, { status: 409 });
      }
      return Response.json({
        ok: true,
        id: existingDm.id,
        created_at: existingDm.created_at,
        dm: serializeDmRoot(existingDm),
        duplicate: true,
      });
    }

    const doId = env.CHAT_ROOM.idFromName(parentChannelId);
    const chatRoom = env.CHAT_ROOM.get(doId);
    const dmRateLimitResponse = await chatRoom.fetch(new Request("http://internal/channel-rate-limit", {
      method: "POST",
      body: JSON.stringify({
        scope: "dm-send",
        subjectKey: `${requesterUid}:${requesterDeviceId}`,
        limit: DM_RATE_LIMIT_MAX,
        windowMs: DM_RATE_LIMIT_WINDOW_MS,
      }),
    }));
    if (!dmRateLimitResponse.ok) {
      return Response.json({ error: "rate_limit_unavailable" }, { status: 503 });
    }
    const dmRateLimit = await dmRateLimitResponse.json() as { ok: boolean };
    if (!dmRateLimit.ok) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }

    if (rawText && !checkMessageLength(rawText)) {
      return Response.json({ error: "message_too_long" }, { status: 400 });
    }

    const [configRows, blocked, allowedByBannedWords] = await Promise.all([
      env.DB.prepare(
        "SELECT id, text FROM config WHERE channel_id = ? AND id IN (?, ?)"
      ).bind(parentChannelId, `dm_${parentChannelId}`, `petition_${parentChannelId}`).all<{ id: string; text: string }>(),
      isBlockedActor({
        env,
        channelId: parentChannelId,
        uid: requesterUid,
        deviceId: requesterDeviceId,
      }),
      rawText ? checkBannedWords(rawText, parentChannelId, env) : Promise.resolve(true),
    ]);

    const config = new Map((configRows.results || []).map((row) => [row.id, row.text]));
    const dmEnabled = config.get(`dm_${parentChannelId}`) !== "false";
    const petitionEnabled = config.get(`petition_${parentChannelId}`) !== "false";
    const isPetition = PETITION_PREFIXES.some((prefix) => trimmedText.startsWith(prefix));

    if (blocked) {
      if (!petitionEnabled || !isPetition || image) {
        return Response.json({ error: "blocked" }, { status: 403 });
      }
      const existingPetition = await env.DB.prepare(
        "SELECT 1 FROM dm WHERE uid = ? AND channel_id = ? AND (text LIKE ? OR text LIKE ?) LIMIT 1"
      ).bind(requesterUid, channel_id, "[Appeal]%", "[이의 제기]%").first();
      if (existingPetition) {
        return Response.json({ error: "petition_exists" }, { status: 409 });
      }
    } else if (!dmEnabled) {
      return Response.json({ error: "dm_disabled" }, { status: 403 });
    }

    if (!allowedByBannedWords) {
      return Response.json({ error: "banned_word" }, { status: 403 });
    }

    const id = crypto.randomUUID();
    const imageQuotaConsumption = image
      ? await prepareAcceptedImageQuotaConsumption(env, {
          authenticatedUserId: trustedAuthenticatedUserId,
          anonymousUid: requesterUid,
          deviceId: requesterDeviceId,
          channelId: channel_id as string,
          recordType: "dm",
          recordId: id,
        })
      : null;
    if (imageQuotaConsumption && !imageQuotaConsumption.ok) {
      const status = imageQuotaConsumption.error === "image_quota_identity_missing" ? 401 : 403;
      return Response.json({ error: imageQuotaConsumption.error }, { status });
    }
    if (image) {
      if (typeof upload_id !== "string" || !upload_id) {
        return Response.json({ error: "invalid_upload_ticket" }, { status: 400 });
      }
      const attachment = await attachUploadTicket({
        env,
        ticketId: upload_id,
        imageUrl: image as string,
        channelId: channel_id as string,
        purpose: "dm",
        uid: requesterUid,
        authUid: trustedAuthenticatedUserId,
        attachedRecordId: id,
      });
      if (!attachment.ok) {
        return Response.json({ error: attachment.error }, { status: 400 });
      }
    }
    const created_at = new Date().toISOString();
    const deviceIdHash = await hashBlockedDeviceId(requesterDeviceId, env);
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO dm (id, client_message_id, uid, auth_uid, nick, text, image, image_w, image_h, channel_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          id,
          clientMessageId,
          requesterUid,
          requesterUid,
          nick || null,
          rawText,
          image || null,
          mediaDimensions?.width ?? null,
          mediaDimensions?.height ?? null,
          channel_id,
          created_at,
        ),
        env.DB.prepare(
          `INSERT OR REPLACE INTO message_actor_identities
            (record_id, record_type, channel_id, uid, device_id_hash, created_at)
           VALUES (?, 'dm', ?, ?, ?, ?)`
        ).bind(id, parentChannelId, requesterUid, deviceIdHash, created_at),
        ...(imageQuotaConsumption?.statement ? [imageQuotaConsumption.statement] : []),
      ]);
    } catch (error) {
      const duplicate = await env.DB.prepare(
        "SELECT * FROM dm WHERE client_message_id = ? LIMIT 1"
      ).bind(clientMessageId).first<DmRoot>();
      if (duplicate?.uid === requesterUid && duplicate.channel_id === channel_id) {
        return Response.json({
          ok: true,
          id: duplicate.id,
          created_at: duplicate.created_at,
          dm: serializeDmRoot(duplicate),
          duplicate: true,
        });
      }
      throw error;
    }

    // Broadcast DM with payload — always use parent channel DO
    const newDm = {
      id,
      uid: requesterUid,
      auth_uid: requesterUid,
      nick: nick || null,
      text: rawText,
      image: image || null,
      image_w: mediaDimensions?.width ?? null,
      image_h: mediaDimensions?.height ?? null,
      channel_id,
      created_at,
    };
    await chatRoom.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "dm-new", dm: newDm }),
    }));
    await chatRoom.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "dm-threads-changed" }),
    }));

    return Response.json({
      ok: true,
      id,
      created_at,
      dm: serializeDmRoot({ ...newDm, client_message_id: clientMessageId }),
    });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}
