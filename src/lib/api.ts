const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

export async function fetchInit(channelId: string) {
  const res = await fetch(`${WORKER_URL}/api/init?channel=${channelId}`);
  if (!res.ok) throw new Error(`Init failed: ${res.status}`);
  return res.json();
}

export async function fetchMessages(channelId: string, cursor?: string) {
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
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, channel_id: channelId, payload }),
  });
  return res.json();
}

export function getWebSocketUrl(channelId: string, uid: string): string {
  const wsBase = WORKER_URL.replace("http://", "ws://").replace("https://", "wss://");
  return `${wsBase}/ws/${channelId}?uid=${uid}`;
}
