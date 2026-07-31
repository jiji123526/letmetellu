import type { Env } from "../types";
import { deleteMediaByUrl } from "./media";

const HOUR_MS = 60 * 60 * 1000;
export const LIVE_SESSION_DURATION_HOURS = 8;
export const LIVE_SESSION_DURATION_MS = LIVE_SESSION_DURATION_HOURS * HOUR_MS;
export const DEFAULT_LIVE_TITLE = "라이브 채팅";

export interface LiveSessionState {
  active: true;
  title: string;
  sessionId: string;
  startedAt: string;
  expiresAt: string;
}

function normalizeIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

export function createLiveSessionState(title: string | undefined, sessionId: string, nowMs = Date.now()): LiveSessionState {
  const startedAt = new Date(nowMs).toISOString();
  return {
    active: true,
    title: title || DEFAULT_LIVE_TITLE,
    sessionId,
    startedAt,
    expiresAt: new Date(nowMs + LIVE_SESSION_DURATION_MS).toISOString(),
  };
}

export function parseLiveSessionState(
  raw: string | null | undefined,
  fallbackUpdatedAt?: string | null,
): LiveSessionState | null {
  if (!raw || raw === "false") return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LiveSessionState> & { active?: boolean };
    if (!parsed || parsed.active !== true) return null;
    const title = typeof parsed.title === "string" && parsed.title.trim()
      ? parsed.title
      : DEFAULT_LIVE_TITLE;
    const sessionId = typeof parsed.sessionId === "string" && parsed.sessionId.trim()
      ? parsed.sessionId
      : "legacy-live-session";
    const startedAt = normalizeIso(parsed.startedAt) || normalizeIso(fallbackUpdatedAt);
    const expiresAt = normalizeIso(parsed.expiresAt)
      || (startedAt ? new Date(Date.parse(startedAt) + LIVE_SESSION_DURATION_MS).toISOString() : null);
    if (!startedAt || !expiresAt) return null;
    return {
      active: true,
      title,
      sessionId,
      startedAt,
      expiresAt,
    };
  } catch {
    return null;
  }
}

export function isLiveSessionExpired(session: LiveSessionState | null, nowMs = Date.now()): boolean {
  if (!session) return false;
  return Date.parse(session.expiresAt) <= nowMs;
}

export async function readLiveSessionState(env: Env, channelId: string): Promise<LiveSessionState | null> {
  const row = await env.DB.prepare(
    "SELECT text, updated_at FROM config WHERE id = ? LIMIT 1"
  ).bind(`live_${channelId}`).first<{ text: string | null; updated_at: string | null }>();
  return parseLiveSessionState(row?.text, row?.updated_at);
}

export async function endLiveSession(
  env: Env,
  channelId: string,
  reason: "manual" | "expired" = "manual",
): Promise<void> {
  const liveChannelId = `${channelId}_live`;

  await env.DB.prepare(
    "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
  ).bind(`live_${channelId}`, "false", channelId, "false").run();

  const doId = env.CHAT_ROOM.idFromName(channelId);
  const stub = env.CHAT_ROOM.get(doId);
  await stub.fetch(new Request("http://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({ type: "live-ended", channel_id: channelId, reason }),
  })).catch(() => null);

  const { results: liveMedia } = await env.DB.prepare(
    "SELECT image FROM messages WHERE channel_id = ? AND image IS NOT NULL"
  ).bind(liveChannelId).all<{ image: string | null }>();
  const { results: liveGalleryMedia } = await env.DB.prepare(
    "SELECT image FROM gallery WHERE channel_id = ? AND image IS NOT NULL"
  ).bind(liveChannelId).all<{ image: string | null }>();
  const { results: liveDmMedia } = await env.DB.prepare(
    "SELECT image FROM dm WHERE channel_id = ? AND image IS NOT NULL"
  ).bind(liveChannelId).all<{ image: string | null }>();
  const { results: liveUploadTickets } = await env.DB.prepare(
    "SELECT key FROM upload_tickets WHERE channel_id = ?"
  ).bind(liveChannelId).all<{ key: string | null }>();

  for (const row of [...(liveMedia || []), ...(liveGalleryMedia || []), ...(liveDmMedia || [])]) {
    await deleteMediaByUrl(env, row.image);
  }
  for (const row of liveUploadTickets || []) {
    if (row.key) {
      await env.MEDIA.delete(row.key).catch(() => {});
    }
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM messages WHERE channel_id = ?").bind(liveChannelId),
    env.DB.prepare("DELETE FROM gallery WHERE channel_id = ?").bind(liveChannelId),
    env.DB.prepare("DELETE FROM dm WHERE channel_id = ?").bind(liveChannelId),
    env.DB.prepare("DELETE FROM blocked WHERE channel_id = ?").bind(liveChannelId),
    env.DB.prepare("DELETE FROM message_actor_identities WHERE channel_id = ?").bind(liveChannelId),
    env.DB.prepare("DELETE FROM config WHERE channel_id = ?").bind(liveChannelId),
    env.DB.prepare("DELETE FROM upload_tickets WHERE channel_id = ?").bind(liveChannelId),
    env.DB.prepare("DELETE FROM channels WHERE id = ?").bind(liveChannelId),
  ]);
}
