import { clearRoomTokenCookie, setRoomTokenCookie } from "./room-token-cookie";

const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === "true";
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
type UploadPurpose = "message" | "dm" | "channel-asset";
type UploadResult = { url: string; uploadId?: string };

function getParentChannelId(channelId: string): string {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

export function getStoredUid(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("letsplay_uid");
}

// Room token management
export function getRoomToken(channelId: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`roomToken_${channelId}`);
}

export function setRoomToken(channelId: string, token: string) {
  localStorage.setItem(`roomToken_${channelId}`, token);
  setRoomTokenCookie(channelId, token);
  window.dispatchEvent(new CustomEvent("room-token-changed", {
    detail: { channelId, token },
  }));
}

export function clearRoomToken(channelId: string) {
  localStorage.removeItem(`roomToken_${channelId}`);
  clearRoomTokenCookie(channelId);
  window.dispatchEvent(new CustomEvent("room-token-changed", {
    detail: { channelId, token: null },
  }));
}

export function setAnonymousIdentity(uid: string) {
  localStorage.setItem("letsplay_uid", uid);
  window.dispatchEvent(new CustomEvent("anonymous-identity-changed", {
    detail: { uid },
  }));
}

function roomTokenHeaders(channelId: string): Record<string, string> {
  const token = getRoomToken(channelId);
  return token ? { "X-Room-Token": token } : {};
}

export function decorateMediaUrl(mediaUrl: string | null | undefined): string | null {
  if (!mediaUrl) return null;

  try {
    const parsed = new URL(mediaUrl, WORKER_URL);
    if (!parsed.pathname.startsWith("/api/media/")) return mediaUrl;
    const proxy = new URL(parsed.pathname, typeof window !== "undefined" ? window.location.origin : WORKER_URL);
    parsed.searchParams.forEach((value, key) => {
      if (key !== "token") proxy.searchParams.append(key, value);
    });
    return typeof window !== "undefined"
      ? `${proxy.pathname}${proxy.search}`
      : proxy.toString();
  } catch {
    return mediaUrl;
  }
}

export function decorateMessageMedia<T extends { image?: string | null }>(message: T): T {
  if (!message.image) return message;
  const image = decorateMediaUrl(message.image);
  return image === message.image ? message : { ...message, image };
}

function decorateChannelMedia<T extends { profile_image?: string | null; background_image?: string | null }>(channel: T): T {
  const profile_image = decorateMediaUrl(channel.profile_image);
  const background_image = decorateMediaUrl(channel.background_image);
  if (profile_image === channel.profile_image && background_image === channel.background_image) return channel;
  return { ...channel, profile_image, background_image };
}

export function decorateWelcomeConfig(config: string | undefined): string | undefined {
  if (!config) return config;
  try {
    const parsed = JSON.parse(config) as { icon?: unknown };
    if (typeof parsed.icon !== "string") return config;
    const icon = decorateMediaUrl(parsed.icon);
    if (!icon || icon === parsed.icon) return config;
    return JSON.stringify({ ...parsed, icon });
  } catch {
    return config;
  }
}

// Dynamic import for mock - re-export functions based on mode
import * as mockApi from "./mock-api";

export async function fetchInit(channelId: string) {
  if (IS_MOCK) return mockApi.fetchInit(channelId);

  const parentChannelId = getParentChannelId(channelId);
  const roomToken = getRoomToken(parentChannelId);
  const headers: Record<string, string> = {};
  if (roomToken) headers["X-Room-Token"] = roomToken;

  // Always use the same-origin proxy. Auth.js session cookies are HttpOnly, so
  // client-side cookie inspection cannot reliably decide whether the user is
  // signed in. The proxy verifies the session server-side and forwards owner
  // identity only when appropriate.
  const res = await fetch(`/api/init?channel=${channelId}`, { headers });
  if (!res.ok) throw new Error(`Init failed: ${res.status}`);
  const data = await res.json();
  if (typeof data?.anonymousUid === "string") {
    setAnonymousIdentity(data.anonymousUid);
  }
  if (data?.roomToken) setRoomToken(parentChannelId, data.roomToken);
  if (data?.channel) data.channel = decorateChannelMedia(data.channel);
  if (Array.isArray(data?.messages)) data.messages = data.messages.map(decorateMessageMedia);
  if (Array.isArray(data?.dm)) data.dm = data.dm.map(decorateMessageMedia);
  if (typeof data?.welcomeConfig === "string") data.welcomeConfig = decorateWelcomeConfig(data.welcomeConfig);
  return data;
}

export async function fetchOwnerChannels(channelId: string): Promise<{
  channels?: Array<{
    id: string;
    name: string;
    profile_image: string | null;
    bubble_color: string;
    has_passcode: number;
  }>;
}> {
  const res = await fetch(`${WORKER_URL}/api/user?channel=${encodeURIComponent(channelId)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Owner channels failed: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data?.channels)) {
    data.channels = data.channels.map((channel: { profile_image?: string | null }) => ({
      ...channel,
      profile_image: decorateMediaUrl(channel.profile_image),
    }));
  }
  return data;
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

  const parentChannelId = getParentChannelId(channelId);
  const params = new URLSearchParams({ type: "messages", channel: channelId });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${WORKER_URL}/api/data?${params}`, {
    headers: roomTokenHeaders(parentChannelId),
  });
  const data = await res.json();
  if (Array.isArray(data?.messages)) data.messages = data.messages.map(decorateMessageMedia);
  return data;
}

export async function fetchMessagePage(
  channelId: string,
  direction: "before" | "after",
  cursor: { createdAt: string; id: string },
) {
  if (IS_MOCK) return mockApi.fetchMessages(channelId, direction === "before" ? cursor.createdAt : undefined);
  const parentChannelId = getParentChannelId(channelId);
  const params = new URLSearchParams({
    type: "messages",
    channel: channelId,
    cursor: cursor.createdAt,
    cursor_id: cursor.id,
    direction,
  });
  const res = await fetch(`/api/data?${params}`, {
    headers: roomTokenHeaders(parentChannelId),
  });
  if (!res.ok) throw new Error(`Message page failed: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data?.messages)) data.messages = data.messages.map(decorateMessageMedia);
  return data;
}

export async function fetchMessageContext(channelId: string, messageId: string) {
  if (IS_MOCK) {
    const data = await mockApi.fetchMessages(channelId);
    const messages = data.messages || [];
    const index = messages.findIndex((message: { id: string }) => message.id === messageId);
    return {
      messages: index < 0 ? [] : messages.slice(Math.max(0, index - 25), index + 26),
      target_id: index < 0 ? null : messageId,
      has_older: index > 25,
      has_newer: index >= 0 && index + 26 < messages.length,
    };
  }
  const parentChannelId = getParentChannelId(channelId);
  const params = new URLSearchParams({
    type: "message-context",
    channel: channelId,
    message_id: messageId,
  });
  const res = await fetch(`/api/data?${params}`, {
    headers: roomTokenHeaders(parentChannelId),
  });
  if (!res.ok) throw new Error(`Message context failed: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data?.messages)) data.messages = data.messages.map(decorateMessageMedia);
  return data;
}

export async function fetchGallery(channelId: string, cursor?: string) {
  if (IS_MOCK) return { gallery: [] };
  const parentChannelId = getParentChannelId(channelId);
  const params = new URLSearchParams({ type: "gallery", channel: channelId });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/data?${params}`, {
    headers: roomTokenHeaders(parentChannelId),
  });
  const data = await res.json();
  if (Array.isArray(data?.gallery)) {
    data.gallery = data.gallery.map((item: { image?: string | null }) => ({
      ...item,
      image: decorateMediaUrl(item.image) || item.image,
    }));
  }
  return data;
}

export async function fetchLinks(channelId: string, cursor?: string) {
  if (IS_MOCK) return { links: [] };
  const parentChannelId = getParentChannelId(channelId);
  const params = new URLSearchParams({ type: "links", channel: channelId });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/data?${params}`, {
    headers: roomTokenHeaders(parentChannelId),
  });
  return res.json();
}

export async function fetchPreview(url: string) {
  const res = await fetch(`${WORKER_URL}/api/preview?url=${encodeURIComponent(url)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function submitChannelReport(payload: {
  channel_id: string;
  reason: string;
  details?: string;
}) {
  if (IS_MOCK) return { ok: true };

  const parentChannelId = getParentChannelId(payload.channel_id);
  const res = await fetch("/api/channel-reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...roomTokenHeaders(parentChannelId),
    },
    body: JSON.stringify({
      channel_id: parentChannelId,
      reason: payload.reason,
      details: payload.details || "",
    }),
  });
  return res.json();
}

export async function sendMessage(payload: {
  uid: string;
  nick?: string;
  text: string;
  channel_id: string;
  image?: string;
  upload_id?: string;
  reply_to?: string;
  fingerprint?: string;
}) {
  if (IS_MOCK) return mockApi.sendMessage(payload);

  const parentChannelId = getParentChannelId(payload.channel_id);
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Mode": "anonymous",
      ...roomTokenHeaders(parentChannelId),
    },
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
  upload_id?: string;
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

  const parentChannelId = getParentChannelId(payload.channel_id);
  const res = await fetch("/api/messages", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Mode": "anonymous",
      ...roomTokenHeaders(parentChannelId),
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function editMessageApi(payload: {
  uid: string;
  message_id: string;
  channel_id: string;
  text: string;
  fingerprint?: string;
  admin?: boolean;
}) {
  if (IS_MOCK) return { ok: true };

  const parentChannelId = getParentChannelId(payload.channel_id);
  const { admin, ...body } = payload;
  const res = await fetch("/api/messages", {
    method: "PUT",
    headers: admin
      ? { "Content-Type": "application/json" }
      : {
          "Content-Type": "application/json",
          "X-Auth-Mode": "anonymous",
          ...roomTokenHeaders(parentChannelId),
        },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function searchMessages(channelId: string, query: string) {
  if (IS_MOCK) return { results: [] };
  const parentChannelId = getParentChannelId(channelId);
  const params = new URLSearchParams({ type: "search", channel: channelId, q: query });
  const res = await fetch(`${WORKER_URL}/api/data?${params}`, {
    headers: roomTokenHeaders(parentChannelId),
  });
  return res.json();
}

export async function sendDm(payload: {
  uid: string;
  nick?: string;
  text: string;
  channel_id: string;
  image?: string;
  upload_id?: string;
  fingerprint?: string;
}) {
  if (IS_MOCK) return { ok: true };
  const parentChannelId = getParentChannelId(payload.channel_id);
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Mode": "anonymous",
      "X-Proxy-Target": "dm",
      ...roomTokenHeaders(parentChannelId),
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.ok && !data?.error) {
    return { ok: true, ...data };
  }
  return data;
}

export async function toggleReaction(payload: { uid: string; message_id: string; channel_id: string; emoji: string }) {
  if (IS_MOCK) return { ok: true };
  const parentChannelId = getParentChannelId(payload.channel_id);
  const res = await fetch("/api/messages", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Mode": "anonymous",
      ...roomTokenHeaders(parentChannelId),
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function toggleReactionAsAdmin(payload: { uid: string; message_id: string; channel_id: string; emoji: string }) {
  if (IS_MOCK) return { ok: true };
  const res = await fetch("/api/messages", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function uploadImage(
  blob: Blob,
  channelId: string,
  purpose: Exclude<UploadPurpose, "channel-asset"> = "message",
): Promise<UploadResult | null> {
  if (IS_MOCK) return { url: URL.createObjectURL(blob) };
  const parentChannelId = getParentChannelId(channelId);
  const params = new URLSearchParams({ channel: channelId, purpose });
  const res = await fetch(`/api/upload?${params.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "image/jpeg",
      "X-Auth-Mode": "anonymous",
      ...roomTokenHeaders(parentChannelId),
    },
    body: blob,
  });
  const result = await res.json() as { ok?: boolean; key?: string; upload_id?: string; url?: string };
  if (result.ok && result.key) {
    return {
      url: result.url ? `${WORKER_URL}${result.url}` : `${WORKER_URL}/api/media/${result.key}`,
      uploadId: result.upload_id,
    };
  }
  return null;
}

export async function uploadAdminImage(
  blob: Blob,
  channelId: string,
  purpose: UploadPurpose = "channel-asset",
): Promise<UploadResult | null> {
  const params = new URLSearchParams({ channel: channelId, purpose });
  const res = await fetch(`/api/upload?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  });
  const result = await res.json() as { ok?: boolean; key?: string; upload_id?: string; url?: string };
  if (result.ok && result.key) {
    return {
      url: result.url ? `${WORKER_URL}${result.url}` : `${WORKER_URL}/api/media/${result.key}`,
      uploadId: result.upload_id,
    };
  }
  return null;
}
