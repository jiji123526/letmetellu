import { Env } from "../types";
import { verifyAnonymousIdentityToken } from "../lib/anonymous-identity";
import { endLiveSession, isLiveSessionExpired, readLiveSessionState } from "../lib/live-sessions";
import { getParentChannelId, isReportsChannel, isReportsChannelOwner } from "../lib/special-channels";
import { createUploadTicket, cleanupExpiredUploadTickets, enforceUploadQuota, getUploadRequestIp, hashUploadIp, type UploadPurpose } from "../lib/upload-tickets";
import { authorizeRoomToken } from "./passcode";
import { getChannelPasscodeInfo } from "../lib/validation";

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MEDIA_KEY_CHANNEL_PATTERN = /^[a-z0-9-]{3,30}(?:_live)?$/;

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function verifyMediaAccessToken(token: string, mediaKey: string, env: Env): Promise<boolean> {
  try {
    const [payloadPart, signaturePart, extra] = token.split(".");
    if (!payloadPart || !signaturePart || extra) return false;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.INTERNAL_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(signaturePart),
      encoder.encode(payloadPart),
    );
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart))) as {
      type?: string;
      key?: string;
      exp?: number;
    };
    return payload.type === "media-access"
      && payload.key === mediaKey
      && typeof payload.exp === "number"
      && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function readChannelIdFromMediaKey(key: string): string | null {
  const slashIndex = key.indexOf("/");
  if (slashIndex <= 0) return null;
  const channelId = key.slice(0, slashIndex);
  return MEDIA_KEY_CHANNEL_PATTERN.test(channelId) ? channelId : null;
}

export async function handleUpload(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const requestUrl = new URL(request.url);
  const channelId = requestUrl.searchParams.get("channel");
  if (!channelId) return Response.json({ error: "missing channel" }, { status: 400 });
  const purpose = (requestUrl.searchParams.get("purpose") || "message") as UploadPurpose;
  if (!["message", "dm", "channel-asset"].includes(purpose)) {
    return Response.json({ error: "invalid upload purpose" }, { status: 400 });
  }

  // Passcode gate
  const parentChannelId = getParentChannelId(channelId);
  if (channelId.endsWith("_live") && purpose !== "channel-asset") {
    const liveSession = await readLiveSessionState(env, parentChannelId);
    if (!liveSession || isLiveSessionExpired(liveSession)) {
      if (liveSession) {
        await endLiveSession(env, parentChannelId, "expired");
      }
      return Response.json({ error: "live_session_ended" }, { status: 403 });
    }
  }
  const internalRequest = request.headers.get("X-Internal-Token") === env.INTERNAL_SECRET;
  const internalUserId = request.headers.get("X-User-Id") || "";
  let ownerUpload = false;
  if (internalRequest && internalUserId) {
    const channel = await env.DB.prepare("SELECT owner_uid FROM channels WHERE id = ?")
      .bind(parentChannelId).first<{ owner_uid: string }>();
    ownerUpload = channel?.owner_uid === internalUserId;
    if (!ownerUpload) return Response.json({ error: "not owner" }, { status: 403 });
  }
  if (isReportsChannel(parentChannelId, env) && !ownerUpload) {
    return Response.json({ error: "owner access required" }, { status: 403 });
  }
  if (purpose === "channel-asset" && !ownerUpload) {
    return Response.json({ error: "not owner" }, { status: 403 });
  }

  const contentType = request.headers.get("Content-Type") || "image/jpeg";

  // Validate content type
  if (!ALLOWED_TYPES.includes(contentType)) {
    return Response.json({ error: "invalid file type" }, { status: 400 });
  }

  // Validate size from Content-Length header
  const contentLength = parseInt(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_UPLOAD_SIZE) {
    return Response.json({ error: "file too large" }, { status: 413 });
  }

  const ext = contentType.includes("png") ? "png" : contentType.includes("gif") ? "gif" : contentType.includes("webp") ? "webp" : "jpg";
  const key = `${channelId}/${crypto.randomUUID()}.${ext}`;

  // Read body with size enforcement (in case Content-Length is spoofed)
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  const reader = request.body!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.byteLength;
    if (totalSize > MAX_UPLOAD_SIZE) {
      reader.cancel();
      return Response.json({ error: "file too large" }, { status: 413 });
    }
    chunks.push(value);
  }

  let anonymousPayload: { uid: string } | null = null;
  let ipHash: string | null = null;
  if (purpose !== "channel-asset") {
    const { passcode } = await getChannelPasscodeInfo(parentChannelId, env);
    if (!ownerUpload && passcode) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
      const decoded = await authorizeRoomToken(roomToken, parentChannelId, passcode, env);
      if (!decoded) {
        return Response.json({ error: "invalid token" }, { status: 403 });
      }
    }

    anonymousPayload = ownerUpload
      ? null
      : await verifyAnonymousIdentityToken(request.headers.get("X-Anonymous-Token") || "", env);
    if (!ownerUpload && !anonymousPayload) {
      return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
    }

    await cleanupExpiredUploadTickets(env);

    ipHash = await hashUploadIp(getUploadRequestIp(request), env);
    const quota = await enforceUploadQuota({
      env,
      channelId,
      uid: ownerUpload ? null : anonymousPayload!.uid,
      ipHash,
      purpose,
    });
    if (!quota.ok) {
      return Response.json({ error: quota.error }, { status: 429 });
    }
  }

  const blob = new Blob(chunks, { type: contentType });

  await env.MEDIA.put(key, blob, {
    httpMetadata: { contentType },
  });

  if (purpose === "channel-asset") {
    return Response.json({ ok: true, key, url: `/api/media/${key}` });
  }

  const ticket = await createUploadTicket({
    env,
    key,
    channelId,
    uid: ownerUpload ? internalUserId : anonymousPayload!.uid,
    authUid: ownerUpload ? internalUserId : null,
    ipHash: ipHash!,
    purpose,
  });

  return Response.json({ ok: true, key, upload_id: ticket.id, url: `/api/media/${key}` });
}

// Serve uploaded media
export async function handleMediaServe(request: Request, env: Env, key: string): Promise<Response> {
  const decodedKey = decodeURIComponent(key);
  const mediaSuffix = `/api/media/${decodedKey}`;
  const inferredChannelId = readChannelIdFromMediaKey(decodedKey);
  let mediaRow: { channel_id: string; source_type: string } | null = null;
  let pendingTicket: { purpose: UploadPurpose; expires_at: string } | null = null;

  if (inferredChannelId) {
    // Message and DM uploads already have a unique indexed key in
    // upload_tickets. Resolve that first so the common media path needs only
    // one narrow D1 read instead of a channel lookup plus a ticket lookup.
    const ticket = await env.DB.prepare(
      "SELECT channel_id, purpose, status, expires_at FROM upload_tickets WHERE key = ? LIMIT 1"
    ).bind(decodedKey).first<{
      channel_id: string;
      purpose: UploadPurpose;
      status: "pending" | "attached" | "cancelled";
      expires_at: string;
    }>();

    if (ticket?.status === "pending") {
      pendingTicket = { purpose: ticket.purpose, expires_at: ticket.expires_at };
    } else if (ticket?.status === "attached") {
      mediaRow = {
        channel_id: ticket.channel_id,
        source_type: ticket.purpose === "dm" ? "dm" : "message",
      };
    } else if (ticket?.status === "cancelled") {
      return new Response("not found", { status: 404 });
    }

    // Channel assets intentionally do not use upload tickets. They are read
    // far less often and are cached for much longer, so fall back to the
    // channel row only when no message/DM ticket resolved the key.
    if (!mediaRow && !pendingTicket) {
      mediaRow = await env.DB.prepare(
        `SELECT id AS channel_id,
                CASE
                  WHEN profile_image IS NOT NULL AND substr(profile_image, -length(?)) = ? THEN 'channel-profile'
                  WHEN background_image IS NOT NULL AND substr(background_image, -length(?)) = ? THEN 'channel-background'
                  ELSE 'channel-media'
                END AS source_type
         FROM channels
         WHERE id = ?
         LIMIT 1`
      ).bind(mediaSuffix, mediaSuffix, mediaSuffix, mediaSuffix, inferredChannelId)
        .first<{ channel_id: string; source_type: string }>();
    }
  }

  if (!mediaRow && !pendingTicket) {
    // Legacy or malformed keys still fall back to the wider reverse lookup.
    const mediaLookupResults = await env.DB.batch([
      env.DB.prepare(
        "SELECT channel_id, 'message' AS source_type FROM messages WHERE image IS NOT NULL AND substr(image, -length(?)) = ? LIMIT 1"
      ).bind(mediaSuffix, mediaSuffix),
      env.DB.prepare(
        "SELECT channel_id, 'gallery' AS source_type FROM gallery WHERE image IS NOT NULL AND substr(image, -length(?)) = ? LIMIT 1"
      ).bind(mediaSuffix, mediaSuffix),
      env.DB.prepare(
        "SELECT channel_id, 'dm' AS source_type FROM dm WHERE image IS NOT NULL AND substr(image, -length(?)) = ? LIMIT 1"
      ).bind(mediaSuffix, mediaSuffix),
      env.DB.prepare(
        "SELECT id AS channel_id, 'channel-profile' AS source_type FROM channels WHERE profile_image IS NOT NULL AND substr(profile_image, -length(?)) = ? LIMIT 1"
      ).bind(mediaSuffix, mediaSuffix),
      env.DB.prepare(
        "SELECT id AS channel_id, 'channel-background' AS source_type FROM channels WHERE background_image IS NOT NULL AND substr(background_image, -length(?)) = ? LIMIT 1"
      ).bind(mediaSuffix, mediaSuffix),
      env.DB.prepare(
        "SELECT channel_id, 'channel-config' AS source_type FROM config WHERE text IS NOT NULL AND instr(text, ?) > 0 LIMIT 1"
      ).bind(mediaSuffix),
      env.DB.prepare(
        "SELECT purpose, expires_at FROM upload_tickets WHERE key = ? AND status = 'pending' LIMIT 1"
      ).bind(decodedKey),
    ]);
    mediaRow = mediaLookupResults
      .slice(0, 6)
      .map((result) => result.results?.[0] as { channel_id: string; source_type: string } | undefined)
      .find((row): row is { channel_id: string; source_type: string } => Boolean(row)) || null;
    pendingTicket = pendingTicket
      || (mediaLookupResults[6].results?.[0] as { purpose: UploadPurpose; expires_at: string } | undefined)
      || null;
  }

  if (pendingTicket && pendingTicket.purpose !== "channel-asset") {
    if (pendingTicket.expires_at <= new Date().toISOString()) {
      await env.MEDIA.delete(decodedKey).catch(() => {});
      await env.DB.prepare("DELETE FROM upload_tickets WHERE key = ?").bind(decodedKey).run();
    }
    return new Response("not found", { status: 404 });
  }

  const requiresRoomAccess = mediaRow?.source_type !== "channel-profile";
  if (mediaRow?.channel_id && requiresRoomAccess) {
    const mediaAccessToken = new URL(request.url).searchParams.get("media_token");
    if (mediaAccessToken && await verifyMediaAccessToken(mediaAccessToken, decodedKey, env)) {
      const object = await env.MEDIA.get(decodedKey);
      if (!object) return new Response("not found", { status: 404 });

      const headers = new Headers();
      headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
      headers.set("Cache-Control", "private, max-age=900");
      return new Response(object.body, { headers });
    }

    const parentChannelId = getParentChannelId(mediaRow.channel_id);
    const { passcode, owner_uid } = await getChannelPasscodeInfo(parentChannelId, env);

    if (passcode) {
      const trustedUserId = request.headers.get("X-Internal-Token") === env.INTERNAL_SECRET
        ? request.headers.get("X-User-Id") || ""
        : "";
      const isOwner = trustedUserId === owner_uid;
      const isReportsOwnerViewer = !isOwner && await isReportsChannelOwner(trustedUserId, env);
      if (!isOwner && !isReportsOwnerViewer) {
        const token = new URL(request.url).searchParams.get("token") || request.headers.get("X-Room-Token");
        if (!token) return Response.json({ error: "passcode required" }, { status: 403 });
        const decoded = await authorizeRoomToken(token, parentChannelId, passcode, env);
        if (!decoded) {
          return Response.json({ error: "invalid token" }, { status: 403 });
        }
      }
    }
  }

  const object = await env.MEDIA.get(decodedKey);
  if (!object) return new Response("not found", { status: 404 });

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set(
    "Cache-Control",
    mediaRow?.source_type === "channel-profile"
      ? "public, max-age=31536000, immutable"
      : mediaRow?.channel_id
        ? "private, no-store"
        : "public, max-age=31536000, immutable",
  );

  return new Response(object.body, { headers });
}
