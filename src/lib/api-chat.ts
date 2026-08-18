import {
  IS_MOCK,
  clearRoomToken,
  decorateChannelMedia,
  decorateMediaUrl,
  decorateMessageMedia,
  decorateProtectedMediaUrl,
  decorateWelcomeConfig,
  getParentChannelId,
  getWorkerUrl,
  roomTokenHeaders,
  setAnonymousIdentity,
  type UploadPurpose,
  type UploadResult,
} from "./api-core";

let mockApiPromise: Promise<typeof import("./mock-api")> | null = null;
const initRequests = new Map<string, Promise<unknown>>();
const messagePageRequests = new Map<string, Promise<unknown>>();
const unifiedPageRequests = new Map<string, Promise<unknown>>();
const ownerChannelRequests = new Map<string, Promise<OwnerChannelsResponse>>();
const ownerChannelCache = new Map<string, { data: OwnerChannelsResponse; expiresAt: number }>();
const MESSAGE_SEND_TIMEOUT_MS = 15_000;
const MAX_MEDIA_UPLOAD_SIZE = 10 * 1024 * 1024;
const OWNER_CHANNEL_CACHE_TTL_MS = 30_000;

export interface OwnerChannelProfile {
  id: string;
  name: string;
  profile_image: string | null;
  bubble_color: string;
  has_passcode: number;
}

export interface OwnerChannelsResponse {
  channels?: OwnerChannelProfile[];
}

export class MediaUploadTooLargeError extends Error {
  constructor() {
    super("Media upload exceeds the 10MB limit");
    this.name = "MediaUploadTooLargeError";
  }
}

export function isMediaUploadTooLarge(blob: Blob): boolean {
  return blob.size > MAX_MEDIA_UPLOAD_SIZE;
}

async function fetchMessageMutation(input: RequestInfo | URL, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MESSAGE_SEND_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function loadMockApi() {
  if (!mockApiPromise) {
    mockApiPromise = import("./mock-api");
  }
  return mockApiPromise;
}

export { clearRoomToken, decorateMediaUrl, decorateProtectedMediaUrl, decorateWelcomeConfig };
export { getStoredUid, notifyRoomAccessGranted } from "./api-core";

async function requestInit(channelId: string) {
  if (IS_MOCK) {
    const mockApi = await loadMockApi();
    return mockApi.fetchInit(channelId);
  }

  const res = await fetch(`/api/init?channel=${channelId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Init failed: ${res.status}`);
  const data = await res.json();
  if (typeof data?.anonymousUid === "string") {
    setAnonymousIdentity(data.anonymousUid);
  }
  if (data?.channel) data.channel = decorateChannelMedia(data.channel);
  if (Array.isArray(data?.messages)) data.messages = data.messages.map(decorateMessageMedia);
  if (Array.isArray(data?.dm)) data.dm = data.dm.map(decorateMessageMedia);
  if (Array.isArray(data?.unifiedTimeline?.items)) {
    data.unifiedTimeline.items = data.unifiedTimeline.items.map(decorateMessageMedia);
  }
  if (typeof data?.welcomeConfig === "string") data.welcomeConfig = decorateWelcomeConfig(data.welcomeConfig);
  return data;
}

export function fetchInit(channelId: string) {
  const existingRequest = initRequests.get(channelId);
  if (existingRequest) return existingRequest;

  const request = requestInit(channelId);
  initRequests.set(channelId, request);
  const clearRequest = () => {
    if (initRequests.get(channelId) === request) {
      initRequests.delete(channelId);
    }
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

export function getCachedOwnerChannels(channelId: string): OwnerChannelsResponse | null {
  const cached = ownerChannelCache.get(channelId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    ownerChannelCache.delete(channelId);
    return null;
  }
  return cached.data;
}

async function requestOwnerChannels(channelId: string): Promise<OwnerChannelsResponse> {
  const res = await fetch(`/api/user?channel=${encodeURIComponent(channelId)}`, {
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

export function fetchOwnerChannels(channelId: string): Promise<OwnerChannelsResponse> {
  const cached = getCachedOwnerChannels(channelId);
  if (cached) return Promise.resolve(cached);

  const existingRequest = ownerChannelRequests.get(channelId);
  if (existingRequest) return existingRequest;

  const request = requestOwnerChannels(channelId)
    .then((data) => {
      ownerChannelCache.set(channelId, {
        data,
        expiresAt: Date.now() + OWNER_CHANNEL_CACHE_TTL_MS,
      });
      return data;
    })
    .finally(() => {
      if (ownerChannelRequests.get(channelId) === request) {
        ownerChannelRequests.delete(channelId);
      }
    });
  ownerChannelRequests.set(channelId, request);
  return request;
}

export function preloadOwnerChannels(channelId: string): Promise<OwnerChannelsResponse> {
  return fetchOwnerChannels(channelId);
}

export async function verifyPasscode(channelId: string, passcode: string): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch("/api/verify-passcode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel_id: channelId, passcode }),
    cache: "no-store",
  });
  const result = await res.json();
  if (res.ok && result?.ok) {
    initRequests.delete(channelId);
    initRequests.delete(`${channelId}_live`);
  }
  return result;
}

export async function fetchMessages(channelId: string, cursor?: string) {
  if (IS_MOCK) {
    const mockApi = await loadMockApi();
    return mockApi.fetchMessages(channelId, cursor);
  }

  const params = new URLSearchParams({ type: "messages", channel: channelId });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/data?${params}`, {
    headers: roomTokenHeaders(),
  });
  const data = await res.json();
  if (Array.isArray(data?.messages)) data.messages = data.messages.map(decorateMessageMedia);
  return data;
}

async function requestMessagePage(
  channelId: string,
  direction: "before" | "after",
  cursor: { createdAt: string; id: string },
) {
  if (IS_MOCK) {
    const mockApi = await loadMockApi();
    return mockApi.fetchMessages(channelId, direction === "before" ? cursor.createdAt : undefined);
  }
  const params = new URLSearchParams({
    type: "messages",
    channel: channelId,
    cursor: cursor.createdAt,
    cursor_id: cursor.id,
    direction,
  });
  const res = await fetch(`/api/data?${params}`, {
    headers: roomTokenHeaders(),
  });
  if (!res.ok) throw new Error(`Message page failed: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data?.messages)) data.messages = data.messages.map(decorateMessageMedia);
  return data;
}

export function fetchMessagePage(
  channelId: string,
  direction: "before" | "after",
  cursor: { createdAt: string; id: string },
) {
  const requestKey = `${channelId}\u0000${direction}\u0000${cursor.createdAt}\u0000${cursor.id}`;
  const existingRequest = messagePageRequests.get(requestKey);
  if (existingRequest) return existingRequest as ReturnType<typeof requestMessagePage>;

  const request = requestMessagePage(channelId, direction, cursor);
  messagePageRequests.set(requestKey, request);
  const clearRequest = () => {
    if (messagePageRequests.get(requestKey) === request) {
      messagePageRequests.delete(requestKey);
    }
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

export interface UnifiedTimelineCursorPayload {
  visual_root_created_at: string;
  source: "message" | "dm";
  visual_root_id: string;
  visual_depth: 0 | 1;
  created_at: string;
  id: string;
}

export interface UnifiedTimelinePagePayload {
  contract_version: 1;
  items: Array<Record<string, unknown>>;
  has_more: boolean;
  page_start_cursor: UnifiedTimelineCursorPayload | null;
  page_end_cursor: UnifiedTimelineCursorPayload | null;
  has_older?: boolean;
  has_newer?: boolean;
  target_id?: string;
  target_source?: "message" | "dm";
}

function appendUnifiedCursor(
  params: URLSearchParams,
  direction: "before" | "after",
  cursor: UnifiedTimelineCursorPayload,
) {
  params.set("direction", direction);
  params.set("cursor_visual_root_created_at", cursor.visual_root_created_at);
  params.set("cursor_source", cursor.source);
  params.set("cursor_visual_root_id", cursor.visual_root_id);
  params.set("cursor_visual_depth", String(cursor.visual_depth));
  params.set("cursor_created_at", cursor.created_at);
  params.set("cursor_id", cursor.id);
}

export function fetchUnifiedTimelinePage(
  channelId: string,
  direction?: "before" | "after",
  cursor?: UnifiedTimelineCursorPayload | null,
): Promise<UnifiedTimelinePagePayload> {
  const params = new URLSearchParams({ channel: channelId });
  if (direction && cursor) appendUnifiedCursor(params, direction, cursor);
  const key = params.toString();
  const existing = unifiedPageRequests.get(key);
  if (existing) return existing as Promise<UnifiedTimelinePagePayload>;
  const request = fetch(`/api/unified-timeline?${params}`, {
    headers: roomTokenHeaders(),
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Unified timeline failed: ${response.status}`);
    const data = await response.json() as UnifiedTimelinePagePayload;
    data.items = data.items.map(decorateMessageMedia);
    return data;
  });
  unifiedPageRequests.set(key, request);
  void request.finally(() => {
    if (unifiedPageRequests.get(key) === request) unifiedPageRequests.delete(key);
  }).catch(() => {});
  return request;
}

export function fetchUnifiedTimelineContext(
  channelId: string,
  targetId: string,
  targetSource: "message" | "dm" = "message",
): Promise<UnifiedTimelinePagePayload> {
  const params = new URLSearchParams({
    channel: channelId,
    target_id: targetId,
    target_source: targetSource,
  });
  const key = params.toString();
  const existing = unifiedPageRequests.get(key);
  if (existing) return existing as Promise<UnifiedTimelinePagePayload>;
  const request = fetch(`/api/unified-timeline?${params}`, {
    headers: roomTokenHeaders(),
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Unified context failed: ${response.status}`);
    const data = await response.json() as UnifiedTimelinePagePayload;
    data.items = data.items.map(decorateMessageMedia);
    return data;
  });
  unifiedPageRequests.set(key, request);
  void request.finally(() => {
    if (unifiedPageRequests.get(key) === request) unifiedPageRequests.delete(key);
  }).catch(() => {});
  return request;
}

export async function fetchMessageContext(channelId: string, messageId: string) {
  if (IS_MOCK) {
    const mockApi = await loadMockApi();
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
  const params = new URLSearchParams({
    type: "message-context",
    channel: channelId,
    message_id: messageId,
  });
  const res = await fetch(`/api/data?${params}`, {
    headers: roomTokenHeaders(),
  });
  if (!res.ok) throw new Error(`Message context failed: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data?.messages)) data.messages = data.messages.map(decorateMessageMedia);
  return data;
}

export async function fetchReplyParents(channelId: string, parentIds: string[]) {
  const uniqueParentIds = [...new Set(parentIds.map((parentId) => parentId.trim()).filter(Boolean))];
  if (uniqueParentIds.length === 0) {
    return { messages: [], missing_ids: [] as string[] };
  }

  if (IS_MOCK) {
    const mockApi = await loadMockApi();
    const data = await mockApi.fetchMessages(channelId);
    const messages = (data.messages || [])
      .filter((message: { id: string }) => uniqueParentIds.includes(message.id))
      .map(decorateMessageMedia);
    const foundIds = new Set(messages.map((message: { id: string }) => message.id));
    return {
      messages,
      missing_ids: uniqueParentIds.filter((parentId) => !foundIds.has(parentId)),
    };
  }

  const params = new URLSearchParams({
    type: "reply-parents",
    channel: channelId,
  });
  for (const parentId of uniqueParentIds) {
    params.append("parent_id", parentId);
  }
  const res = await fetch(`/api/data?${params}`, {
    headers: roomTokenHeaders(),
  });
  if (!res.ok) throw new Error(`Reply parents failed: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data?.messages)) data.messages = data.messages.map(decorateMessageMedia);
  return data;
}

export async function fetchGallery(channelId: string, cursor?: string, cursorId?: string) {
  if (IS_MOCK) return { gallery: [] };
  const params = new URLSearchParams({ type: "gallery", channel: channelId });
  if (cursor) params.set("cursor", cursor);
  if (cursorId) params.set("cursor_id", cursorId);
  const res = await fetch(`/api/data?${params}`, {
    headers: roomTokenHeaders(),
  });
  const data = await res.json();
  if (Array.isArray(data?.gallery)) {
    data.gallery = data.gallery.map((item: { image?: string | null }) => ({
      ...item,
      image: decorateProtectedMediaUrl(item.image) || item.image,
    }));
  }
  return data;
}

export async function fetchLinks(channelId: string, cursor?: string) {
  if (IS_MOCK) return { links: [] };
  const params = new URLSearchParams({ type: "links", channel: channelId });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/data?${params}`, {
    headers: roomTokenHeaders(),
  });
  return res.json();
}

export async function fetchPreview(url: string) {
  const res = await fetch(`/api/preview?url=${encodeURIComponent(url)}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

export async function submitChannelReport(payload: {
  channel_id: string;
  reason: string;
  details?: string;
}) {
  if (IS_MOCK) return { ok: true };

  const res = await fetch("/api/channel-reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...roomTokenHeaders(),
    },
    body: JSON.stringify({
      channel_id: getParentChannelId(payload.channel_id),
      reason: payload.reason,
      details: payload.details || "",
    }),
  });
  const data = await res.json();
  return {
    ...data,
    _status: res.status,
  };
}

export async function actOnChannelReport(payload: {
  report_id?: string;
  petition_id?: string;
  action:
    | "resolve"
    | "dismiss"
    | "warn_owner"
    | "send_suspend_notice"
    | "freeze_channel"
    | "unfreeze_channel"
    | "delete_channel"
    | "accept_petition"
    | "reject_petition";
  resolution_note?: string;
}) {
  if (IS_MOCK) return { ok: true };

  const res = await fetch("/api/channel-reports", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function adminAction(
  action: string,
  channelId: string,
  payload?: Record<string, unknown>,
  options?: { keepalive?: boolean },
) {
  if (IS_MOCK) {
    const mockApi = await loadMockApi();
    return mockApi.adminAction(action, channelId, payload);
  }

  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, channel_id: channelId, payload }),
    keepalive: options?.keepalive,
  });
  return res.json();
}

export async function submitModerationPetition(channelId: string, text: string) {
  if (IS_MOCK) return { ok: true };
  return adminAction("submit-moderation-petition", channelId, { text });
}

export async function sendMessage(payload: {
  client_message_id: string;
  uid: string;
  nick?: string;
  text: string;
  channel_id: string;
  image?: string;
  upload_id?: string;
  reply_to?: string;
  report?: boolean;
  reported_msg_id?: string;
}) {
  if (IS_MOCK) {
    const mockApi = await loadMockApi();
    return mockApi.sendMessage(payload);
  }

  const res = await fetchMessageMutation("/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Mode": "anonymous",
      ...roomTokenHeaders(),
    },
    body: JSON.stringify(payload),
  });
  if (res.status >= 500) throw new Error(`Message send failed: ${res.status}`);
  const result = await res.json();
  if (result?.message) result.message = decorateMessageMedia(result.message);
  return result;
}

export async function sendMessageAsAdmin(payload: {
  client_message_id: string;
  uid: string;
  nick?: string;
  text: string;
  channel_id: string;
  image?: string;
  upload_id?: string;
  reply_to?: string;
  report?: boolean;
  reported_msg_id?: string;
}) {
  if (IS_MOCK) {
    const mockApi = await loadMockApi();
    return mockApi.sendMessage(payload);
  }

  const res = await fetchMessageMutation("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status >= 500) throw new Error(`Message send failed: ${res.status}`);
  const result = await res.json();
  if (result?.message) result.message = decorateMessageMedia(result.message);
  return result;
}

export function getWebSocketUrl(channelId: string, uid: string): string {
  if (IS_MOCK) return "";
  const wsBase = getWorkerUrl().replace("http://", "ws://").replace("https://", "wss://");
  return `${wsBase}/ws/${channelId}?uid=${uid}`;
}

export async function deleteMessage(payload: {
  uid: string;
  message_id: string;
  channel_id: string;
  soft?: boolean;
}) {
  if (IS_MOCK) return { ok: true };

  const res = await fetch("/api/messages", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Mode": "anonymous",
      ...roomTokenHeaders(),
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
  admin?: boolean;
}) {
  if (IS_MOCK) return { ok: true };

  const { admin, ...body } = payload;
  const res = await fetch("/api/messages", {
    method: "PUT",
    headers: admin
      ? { "Content-Type": "application/json" }
      : {
          "Content-Type": "application/json",
          "X-Auth-Mode": "anonymous",
          ...roomTokenHeaders(),
        },
    body: JSON.stringify(body),
  });
  return res.json();
}

export interface MessageSearchCursor {
  visual_root_created_at?: string;
  visual_root_id?: string;
  visual_depth?: number;
  created_at: string;
  id: string;
}

export interface MessageSearchResult {
  id: string;
  text: string;
  created_at: string;
  reply_to?: string | null;
  visual_root_created_at?: string;
  visual_root_id?: string;
  visual_depth?: number;
}

export interface MessageSearchResponse {
  results: MessageSearchResult[];
  has_more: boolean;
  next_cursor: MessageSearchCursor | null;
}

export async function searchMessages(
  channelId: string,
  query: string,
  cursor?: MessageSearchCursor | null,
): Promise<MessageSearchResponse> {
  if (IS_MOCK) return { results: [], has_more: false, next_cursor: null };
  const params = new URLSearchParams({ type: "search", channel: channelId, q: query });
  if (cursor) {
    params.set("cursor", cursor.created_at);
    params.set("cursor_id", cursor.id);
    if (
      cursor.visual_root_created_at
      && cursor.visual_root_id
      && Number.isInteger(cursor.visual_depth)
    ) {
      params.set("cursor_root_created_at", cursor.visual_root_created_at);
      params.set("cursor_root_id", cursor.visual_root_id);
      params.set("cursor_depth", String(cursor.visual_depth));
    }
  }
  const res = await fetch(`/api/data?${params}`, {
    headers: roomTokenHeaders(),
  });
  if (!res.ok) throw new Error(`Message search failed: ${res.status}`);
  return res.json() as Promise<MessageSearchResponse>;
}

export async function sendDm(payload: {
  client_message_id: string;
  uid: string;
  nick?: string;
  text: string;
  channel_id: string;
  image?: string;
  upload_id?: string;
}) {
  if (IS_MOCK) return { ok: true };
  const res = await fetchMessageMutation("/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Mode": "anonymous",
      "X-Proxy-Target": "dm",
      ...roomTokenHeaders(),
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.ok && !data?.error) {
    return { ok: true, ...data };
  }
  return data;
}

export async function fetchDmThreads(channelId: string) {
  if (IS_MOCK) return { dm: [] };
  const params = new URLSearchParams({ channel: channelId });
  const res = await fetch(`/api/dm?${params}`, {
    headers: roomTokenHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`DM threads failed: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data?.dm)) data.dm = data.dm.map(decorateMessageMedia);
  return data;
}

export async function sendDmReply(payload: {
  client_reply_id: string;
  dm_id: string;
  text: string;
  image?: string;
  upload_id?: string;
}) {
  if (IS_MOCK) return { ok: true };
  const res = await fetchMessageMutation("/api/dm", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data?.reply) data.reply = decorateMessageMedia(data.reply);
  return res.ok && !data?.error ? { ok: true, ...data } : data;
}

export async function deleteDm(payload: {
  dm_id: string;
  channel_id: string;
}) {
  if (IS_MOCK) return { ok: true };
  const res = await fetchMessageMutation("/api/dm", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...roomTokenHeaders(),
    },
    body: JSON.stringify(payload),
    keepalive: true,
  });
  const data = await res.json();
  return res.ok && !data?.error ? { ok: true, ...data } : data;
}

export async function toggleReaction(payload: { uid: string; message_id: string; channel_id: string; emoji: string }) {
  if (IS_MOCK) return { ok: true };
  const res = await fetch("/api/messages", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Mode": "anonymous",
      ...roomTokenHeaders(),
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
  if (isMediaUploadTooLarge(blob)) throw new MediaUploadTooLargeError();
  const params = new URLSearchParams({ channel: channelId, purpose });
  const res = await fetch(`/api/upload?${params.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "image/jpeg",
      "X-Auth-Mode": "anonymous",
      ...roomTokenHeaders(),
    },
    body: blob,
  });
  if (res.status === 413) throw new MediaUploadTooLargeError();
  const result = await res.json() as { ok?: boolean; key?: string; upload_id?: string; url?: string };
  if (result.ok && result.key) {
    return {
      url: result.url ? `${getWorkerUrl()}${result.url}` : `${getWorkerUrl()}/api/media/${result.key}`,
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
  if (isMediaUploadTooLarge(blob)) throw new MediaUploadTooLargeError();
  const params = new URLSearchParams({ channel: channelId, purpose });
  const res = await fetch(`/api/upload?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  });
  if (res.status === 413) throw new MediaUploadTooLargeError();
  const result = await res.json() as { ok?: boolean; key?: string; upload_id?: string; url?: string };
  if (result.ok && result.key) {
    return {
      url: result.url ? `${getWorkerUrl()}${result.url}` : `${getWorkerUrl()}/api/media/${result.key}`,
      uploadId: result.upload_id,
    };
  }
  return null;
}
