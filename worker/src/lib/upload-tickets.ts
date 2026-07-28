import { Env } from "../types";

export type UploadPurpose = "message" | "dm" | "channel-asset";

const UPLOAD_TICKET_TTL_MS = 15 * 60 * 1000;
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const MAX_UPLOADS_PER_UID_WINDOW = 12;
const MAX_UPLOADS_PER_IP_WINDOW = 24;
const MAX_PENDING_UPLOADS_PER_UID = 4;
const MAX_PENDING_UPLOADS_PER_IP = 8;

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function getUploadRequestIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Client-IP")
    || "unknown";
}

export async function hashUploadIp(ip: string, env: Env): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.INTERNAL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`upload-ip:${ip}`))
  );
  return base64UrlEncode(signature);
}

export async function cleanupExpiredUploadTickets(env: Env, limit = 50): Promise<void> {
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(
    "SELECT id, key FROM upload_tickets WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at ASC LIMIT ?"
  ).bind(now, limit).all<{ id: string; key: string }>();

  for (const row of results || []) {
    await env.MEDIA.delete(row.key).catch(() => {});
  }

  if ((results || []).length > 0) {
    const ids = (results || []).map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    await env.DB.prepare(`DELETE FROM upload_tickets WHERE id IN (${placeholders})`)
      .bind(...ids)
      .run();
  }
}

export async function enforceUploadQuota(input: {
  env: Env;
  channelId: string;
  uid: string | null;
  ipHash: string;
  purpose: UploadPurpose;
}): Promise<{ ok: true } | { ok: false; error: "upload_rate_limited" | "too_many_pending_uploads" }> {
  const { env, channelId, uid, ipHash, purpose } = input;
  if (purpose === "channel-asset") return { ok: true };

  const recentCutoff = new Date(Date.now() - UPLOAD_WINDOW_MS).toISOString();
  const now = new Date().toISOString();

  const [uidRecentRow, ipRecentRow, uidPendingRow, ipPendingRow] = await Promise.all([
    uid
      ? env.DB.prepare(
          "SELECT COUNT(*) AS count FROM upload_tickets WHERE channel_id = ? AND uid = ? AND purpose IN ('message', 'dm') AND created_at >= ?"
        ).bind(channelId, uid, recentCutoff).first<{ count: number }>()
      : Promise.resolve<{ count: number } | null>(null),
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM upload_tickets WHERE channel_id = ? AND ip_hash = ? AND purpose IN ('message', 'dm') AND created_at >= ?"
    ).bind(channelId, ipHash, recentCutoff).first<{ count: number }>(),
    uid
      ? env.DB.prepare(
          "SELECT COUNT(*) AS count FROM upload_tickets WHERE channel_id = ? AND uid = ? AND purpose IN ('message', 'dm') AND status = 'pending' AND expires_at > ?"
        ).bind(channelId, uid, now).first<{ count: number }>()
      : Promise.resolve<{ count: number } | null>(null),
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM upload_tickets WHERE channel_id = ? AND ip_hash = ? AND purpose IN ('message', 'dm') AND status = 'pending' AND expires_at > ?"
    ).bind(channelId, ipHash, now).first<{ count: number }>(),
  ]);

  if ((uidRecentRow?.count || 0) >= MAX_UPLOADS_PER_UID_WINDOW) return { ok: false, error: "upload_rate_limited" };
  if ((ipRecentRow?.count || 0) >= MAX_UPLOADS_PER_IP_WINDOW) return { ok: false, error: "upload_rate_limited" };
  if ((uidPendingRow?.count || 0) >= MAX_PENDING_UPLOADS_PER_UID) return { ok: false, error: "too_many_pending_uploads" };
  if ((ipPendingRow?.count || 0) >= MAX_PENDING_UPLOADS_PER_IP) return { ok: false, error: "too_many_pending_uploads" };

  return { ok: true };
}

export async function createUploadTicket(input: {
  env: Env;
  key: string;
  channelId: string;
  uid: string | null;
  authUid: string | null;
  ipHash: string;
  purpose: UploadPurpose;
}): Promise<{ id: string; expiresAt: string }> {
  const { env, key, channelId, uid, authUid, ipHash, purpose } = input;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + UPLOAD_TICKET_TTL_MS).toISOString();
  await env.DB.prepare(`
    INSERT INTO upload_tickets (
      id, key, channel_id, uid, auth_uid, purpose, ip_hash, status, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(id, key, channelId, uid, authUid, purpose, ipHash, createdAt, expiresAt).run();
  return { id, expiresAt };
}

export async function attachUploadTicket(input: {
  env: Env;
  ticketId: string;
  imageUrl: string;
  channelId: string;
  purpose: Exclude<UploadPurpose, "channel-asset">;
  uid: string | null;
  authUid: string | null;
  attachedRecordId: string;
}): Promise<{ ok: true } | { ok: false; error: "invalid_upload_ticket" }> {
  const { env, ticketId, imageUrl, channelId, purpose, uid, authUid, attachedRecordId } = input;
  const mediaKey = extractMediaKey(imageUrl);
  if (!mediaKey) return { ok: false, error: "invalid_upload_ticket" };

  const ticket = await env.DB.prepare(`
    SELECT id, uid, auth_uid, key
    FROM upload_tickets
    WHERE id = ?
      AND channel_id = ?
      AND purpose = ?
      AND status = 'pending'
      AND expires_at > ?
  `).bind(ticketId, channelId, purpose, new Date().toISOString()).first<{
    id: string;
    uid: string | null;
    auth_uid: string | null;
    key: string;
  }>();
  if (!ticket || ticket.key !== mediaKey) return { ok: false, error: "invalid_upload_ticket" };

  const matchesUid = uid && ticket.uid === uid;
  const matchesAuthUid = authUid && ticket.auth_uid === authUid;
  if (!matchesUid && !matchesAuthUid) return { ok: false, error: "invalid_upload_ticket" };

  await env.DB.prepare(`
    UPDATE upload_tickets
    SET status = 'attached', attached_record_id = ?, attached_record_type = ?
    WHERE id = ?
  `).bind(attachedRecordId, purpose, ticketId).run();

  return { ok: true };
}

export async function deleteUploadTicketByAttachment(
  env: Env,
  recordType: "message" | "dm",
  recordId: string,
): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM upload_tickets WHERE attached_record_type = ? AND attached_record_id = ?"
  ).bind(recordType, recordId).run();
}

export function extractMediaKey(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  try {
    const parsed = new URL(imageUrl);
    if (!parsed.pathname.startsWith("/api/media/")) return null;
    return decodeURIComponent(parsed.pathname.replace(/^\/api\/media\//, ""));
  } catch {
    return imageUrl.includes("/api/media/")
      ? decodeURIComponent(imageUrl.split("/api/media/").pop() || "")
      : null;
  }
}
