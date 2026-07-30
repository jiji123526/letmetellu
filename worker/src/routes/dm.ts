import { Env } from "../types";
import { verifyAnonymousIdentityToken, verifyDeviceIdentityToken } from "../lib/anonymous-identity";
import { isReportsChannel } from "../lib/special-channels";
import { attachUploadTicket } from "../lib/upload-tickets";
import { checkBannedWords, checkMessageLength, getChannelPasscodeInfo } from "../lib/validation";
import { consumeDurableRateLimit } from "../lib/durable-rate-limit";
import { hashBlockedDeviceId, isBlockedActor } from "../lib/actor-identities";
import { authorizeRoomToken } from "./passcode";

const PETITION_PREFIXES = ["[Appeal]", "[이의 제기]"];
const DM_RATE_LIMIT_WINDOW_MS = 10_000;
const DM_RATE_LIMIT_MAX = 5;

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
  if (request.method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const { nick, text, channel_id, image, upload_id } = body;

    if (!channel_id) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }
    if (text !== undefined && typeof text !== "string") {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }
    const rawText = typeof text === "string" ? text : "";
    const trimmedText = rawText.trim();
    if (!trimmedText && !image) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Passcode gate
    const parentChannelId = (channel_id as string).endsWith("_live") ? (channel_id as string).replace(/_live$/, "") : channel_id as string;
    if (isReportsChannel(parentChannelId, env)) {
      return Response.json({ error: "owner access required" }, { status: 403 });
    }
    const { passcode } = await getChannelPasscodeInfo(parentChannelId, env);
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

    const dmRateLimit = await consumeDurableRateLimit({
      env,
      scope: "dm-send",
      subjectKey: `${parentChannelId}:${requesterUid}:${requesterDeviceId || "unknown"}`,
      limit: DM_RATE_LIMIT_MAX,
      windowMs: DM_RATE_LIMIT_WINDOW_MS,
    });
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
        authUid: null,
        attachedRecordId: id,
      });
      if (!attachment.ok) {
        return Response.json({ error: attachment.error }, { status: 400 });
      }
    }
    const created_at = new Date().toISOString();
    const deviceIdHash = await hashBlockedDeviceId(requesterDeviceId, env);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO dm (id, uid, auth_uid, nick, text, image, channel_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(id, requesterUid, requesterUid, nick || null, rawText, image || null, channel_id, created_at),
      env.DB.prepare(
        `INSERT OR REPLACE INTO message_actor_identities
          (record_id, record_type, channel_id, uid, device_id_hash, created_at)
         VALUES (?, 'dm', ?, ?, ?, ?)`
      ).bind(id, parentChannelId, requesterUid, deviceIdHash, created_at),
    ]);

    // Broadcast DM with payload — always use parent channel DO
    const doId = env.CHAT_ROOM.idFromName(parentChannelId);
    const stub = env.CHAT_ROOM.get(doId);
    const newDm = { id, uid: requesterUid, auth_uid: requesterUid, nick: nick || null, text: rawText, image: image || null, channel_id, created_at };
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "dm-new", dm: newDm }),
    }));

    return Response.json({ ok: true, id, created_at });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}
