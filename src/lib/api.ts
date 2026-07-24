const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === "true";
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

// Room token management
function getRoomToken(channelId: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`roomToken_${channelId}`);
}

export function setRoomToken(channelId: string, token: string) {
  localStorage.setItem(`roomToken_${channelId}`, token);
}

export function clearRoomToken(channelId: string) {
  localStorage.removeItem(`roomToken_${channelId}`);
}

function roomTokenHeaders(channelId: string): Record<string, string> {
  const token = getRoomToken(channelId);
  return token ? { "X-Room-Token": token } : {};
}

// Dynamic import for mock - re-export functions based on mode
import * as mockApi from "./mock-api";

export async function fetchInit(channelId: string) {
  if (IS_MOCK) return mockApi.fetchInit(channelId);

  const parentChannelId = channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
  const roomToken = getRoomToken(parentChannelId);
  const headers: Record<string, string> = {};
  if (roomToken) headers["X-Room-Token"] = roomToken;

  // If user has a session cookie, route through Vercel proxy for owner bypass
  // Otherwise, call Worker directly (faster, no proxy overhead)
  const hasSession = typeof document !== "undefined" &&
    (document.cookie.includes("next-auth.session-token") || document.cookie.includes("__Secure-next-auth.session-token"));

  if (hasSession) {
    const res = await fetch(`/api/init?channel=${channelId}`, { headers });
    if (!res.ok) throw new Error(`Init failed: ${res.status}`);
    return res.json();
  } else {
    const res = await fetch(`${WORKER_URL}/api/init?channel=${channelId}`, { headers });
    if (!res.ok) throw new Error(`Init failed: ${res.status}`);
    return res.json();
  }
}

export async function verifyPasscode(channelId: string, passcode: string): Promise<{ token?: string; error?: string }> {
  const res = await fetch(`${WORKER_URL}/api/verify-passcode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel_id: channelId, passcode }),
  });
  return res.json();
}

export async function fetchMessages(channelId: string, cursor?: string) {
  if (IS_MOCK) return mockApi.fetchMessages(channelId, cursor);

  const parentChannelId = channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
  const params = new URLSearchParams({ type: "messages", channel: channelId });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${WORKER_URL}/api/data?${params}`, {
    headers: roomTokenHeaders(parentChannelId),
  });
  return res.json();
}

export async function fetchDm(channelId: string) {
  if (IS_MOCK) return { dm: [] };
  const parentChannelId = channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
  const params = new URLSearchParams({ type: "dm", channel: channelId });
  const res = await fetch(`${WORKER_URL}/api/data?${params}`, {
    headers: roomTokenHeaders(parentChannelId),
  });
  return res.json();
}

export async function fetchGallery(channelId: string, cursor?: string) {
  if (IS_MOCK) return { gallery: [] };
  const parentChannelId = channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
  const params = new URLSearchParams({ type: "gallery", channel: channelId });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${WORKER_URL}/api/data?${params}`, {
    headers: roomTokenHeaders(parentChannelId),
  });
  return res.json();
}

export async function fetchLinks(channelId: string, cursor?: string) {
  if (IS_MOCK) return { links: [] };
  const parentChannelId = channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
  const params = new URLSearchParams({ type: "links", channel: channelId });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${WORKER_URL}/api/data?${params}`, {
    headers: roomTokenHeaders(parentChannelId),
  });
  return res.json();
}

export async function fetchPreview(url: string) {
  const res = await fetch(`${WORKER_URL}/api/preview?url=${encodeURIComponent(url)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function sendMessage(payload: {
  uid: string;
  nick?: string;
  text: string;
  channel_id: string;
  image?: string;
  reply_to?: string;
  fingerprint?: string;
}) {
  if (IS_MOCK) return mockApi.sendMessage(payload);

  const parentChannelId = payload.channel_id.endsWith("_live") ? payload.channel_id.replace(/_live$/, "") : payload.channel_id;
  const res = await fetch(`${WORKER_URL}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...roomTokenHeaders(parentChannelId) },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// Admin sends through Vercel proxy (session-verified, is_admin trusted)
export async function sendMessageAsAdmin(payload: {
  uid: string;
  nick?: string;
  text: string;
  channel_id: string;
  image?: string;
  reply_to?: string;
  fingerprint?: string;
  report?: boolean;
  reported_msg_id?: string;
}) {
  if (IS_MOCK) return mockApi.sendMessage(payload);

  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function adminAction(
  action: string,
  channelId: string,
  payload?: Record<string, unknown>
) {
  if (IS_MOCK) return mockApi.adminAction(action, channelId, payload);

  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, channel_id: channelId, payload }),
  });
  return res.json();
}

export function getWebSocketUrl(channelId: string, uid: string): string {
  if (IS_MOCK) return "";
  const wsBase = WORKER_URL.replace("http://", "ws://").replace("https://", "wss://");
  return `${wsBase}/ws/${channelId}?uid=${uid}`;
}

export async function deleteMessage(payload: {
  uid: string;
  message_id: string;
  channel_id: string;
  soft?: boolean;
}) {
  if (IS_MOCK) return { ok: true };

  const parentChannelId = payload.channel_id.endsWith("_live") ? payload.channel_id.replace(/_live$/, "") : payload.channel_id;
  const res = await fetch(`${WORKER_URL}/api/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...roomTokenHeaders(parentChannelId) },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function editMessageApi(payload: {
  uid: string;
  message_id: string;
  channel_id: string;
  text: string;
}) {
  if (IS_MOCK) return { ok: true };

  const parentChannelId = payload.channel_id.endsWith("_live") ? payload.channel_id.replace(/_live$/, "") : payload.channel_id;
  const res = await fetch(`${WORKER_URL}/api/messages`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...roomTokenHeaders(parentChannelId) },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function searchMessages(channelId: string, query: string) {
  if (IS_MOCK) return { results: [] };
  const parentChannelId = channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
  const params = new URLSearchParams({ type: "search", channel: channelId, q: query });
  const res = await fetch(`${WORKER_URL}/api/data?${params}`, {
    headers: roomTokenHeaders(parentChannelId),
  });
  return res.json();
}

export async function sendDm(payload: { uid: string; nick?: string; text: string; channel_id: string; image?: string }) {
  if (IS_MOCK) return { ok: true };
  const parentChannelId = payload.channel_id.endsWith("_live") ? payload.channel_id.replace(/_live$/, "") : payload.channel_id;
  const res = await fetch(`${WORKER_URL}/api/dm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...roomTokenHeaders(parentChannelId) },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function toggleReaction(payload: { uid: string; message_id: string; channel_id: string; emoji: string }) {
  if (IS_MOCK) return { ok: true };
  const parentChannelId = payload.channel_id.endsWith("_live") ? payload.channel_id.replace(/_live$/, "") : payload.channel_id;
  const res = await fetch(`${WORKER_URL}/api/messages`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...roomTokenHeaders(parentChannelId) },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function uploadImage(blob: Blob, channelId: string): Promise<string | null> {
  if (IS_MOCK) return URL.createObjectURL(blob);
  const parentChannelId = channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
  const res = await fetch(`${WORKER_URL}/api/upload?channel=${channelId}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg", ...roomTokenHeaders(parentChannelId) },
    body: blob,
  });
  const result = await res.json() as { ok?: boolean; key?: string };
  if (result.ok && result.key) {
    return `${WORKER_URL}/api/media/${result.key}`;
  }
  return null;
}
