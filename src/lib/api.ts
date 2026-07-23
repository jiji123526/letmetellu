const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === "true";
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

// Dynamic import for mock - re-export functions based on mode
import * as mockApi from "./mock-api";

export async function fetchInit(channelId: string) {
  if (IS_MOCK) return mockApi.fetchInit(channelId);

  const res = await fetch(`${WORKER_URL}/api/init?channel=${channelId}`);
  if (!res.ok) throw new Error(`Init failed: ${res.status}`);
  return res.json();
}

export async function fetchMessages(channelId: string, cursor?: string) {
  if (IS_MOCK) return mockApi.fetchMessages(channelId, cursor);

  const params = new URLSearchParams({ type: "messages", channel: channelId });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${WORKER_URL}/api/data?${params}`);
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

  const res = await fetch(`${WORKER_URL}/api/messages`, {
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

  const res = await fetch(`${WORKER_URL}/api/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
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

  const res = await fetch(`${WORKER_URL}/api/messages`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function searchMessages(channelId: string, query: string) {
  if (IS_MOCK) return { results: [] };
  const params = new URLSearchParams({ type: "search", channel: channelId, q: query });
  const res = await fetch(`${WORKER_URL}/api/data?${params}`);
  return res.json();
}

export async function sendDm(payload: { uid: string; nick?: string; text: string; channel_id: string; image?: string }) {
  if (IS_MOCK) return { ok: true };
  const res = await fetch(`${WORKER_URL}/api/dm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function toggleReaction(payload: { uid: string; message_id: string; channel_id: string; emoji: string }) {
  if (IS_MOCK) return { ok: true };
  const res = await fetch(`${WORKER_URL}/api/messages`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function uploadImage(blob: Blob, channelId: string): Promise<string | null> {
  if (IS_MOCK) return URL.createObjectURL(blob);
  const res = await fetch(`${WORKER_URL}/api/upload?channel=${channelId}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  });
  const result = await res.json() as { ok?: boolean; key?: string };
  if (result.ok && result.key) {
    return `${WORKER_URL}/api/media/${result.key}`;
  }
  return null;
}
