import { clearRoomTokenCookie, setRoomTokenCookie } from "./room-token-cookie";

const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === "true";
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
type UploadPurpose = "message" | "dm" | "channel-asset";
type UploadResult = { url: string; uploadId?: string };

type SupportNodeKind = "choice" | "text" | "escalate" | "terminal";
type SupportSessionStatus = "open" | "resolved" | "escalated" | "abandoned";
type SupportThreadStatus = "open" | "closed";

export interface SupportChoice {
  id: string;
  label: string;
  next: string;
  topic?: string;
}

export interface SupportNodeState {
  id: string;
  kind: SupportNodeKind;
  messages: string[];
  choices: SupportChoice[];
  placeholder: string;
  submitLabel: string;
  escalationLabel: string;
  resolution: "resolved" | "needs_handoff" | null;
}

export interface SupportSessionState {
  id: string;
  status: SupportSessionStatus;
  entry_topic: string | null;
  entry_topic_label: string;
  current_node_id: string;
  resolved_via_tree: boolean;
  escalated_thread_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface SupportThreadState {
  id: string;
  user_id: string;
  source_session_id: string | null;
  entry_topic: string | null;
  entry_topic_label: string;
  summary: string;
  status: SupportThreadStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
  user_name: string | null;
  user_email: string | null;
  last_message: string | null;
}

export interface SupportMessage {
  id: string;
  thread_id: string;
  sender_role: "user" | "platform_admin";
  sender_user_id: string | null;
  text: string;
  created_at: string;
}

export interface SupportTranscriptEvent {
  id: string;
  event_type: "bot_message" | "user_choice" | "user_text" | "escalation";
  node_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface SupportStateResponse {
  error?: string;
  platformAdmin?: boolean;
  thread: SupportThreadState | null;
  messages: SupportMessage[];
  session: SupportSessionState | null;
  transcript: SupportTranscriptEvent[];
  currentNode: SupportNodeState | null;
}

export interface PlatformSupportThreadsResponse {
  error?: string;
  threads: SupportThreadState[];
}

export interface PlatformSupportThreadResponse {
  error?: string;
  thread: SupportThreadState | null;
  messages: SupportMessage[];
}

export interface PlatformSupportSessionResponse {
  error?: string;
  session: SupportSessionState | null;
  transcript: SupportTranscriptEvent[];
  currentNode: SupportNodeState | null;
}

type SupportApiResult<T extends object> = T & { _status: number };

const mockSupportNodes: Record<string, SupportNodeState> = {
  start: {
    id: "start",
    kind: "choice",
    messages: ["Tell me what you need help with first."],
    choices: [
      { id: "topic-login", label: "Login or account", next: "login-details", topic: "login" },
      { id: "topic-other", label: "Other", next: "other-details", topic: "other" },
    ],
    placeholder: "",
    submitLabel: "",
    escalationLabel: "",
    resolution: null,
  },
  "login-details": {
    id: "login-details",
    kind: "text",
    messages: ["Describe the login issue and what you already tried."],
    choices: [],
    placeholder: "Describe the issue",
    submitLabel: "Continue",
    escalationLabel: "",
    resolution: null,
  },
  "other-details": {
    id: "other-details",
    kind: "text",
    messages: ["Describe the issue and what you expected to happen."],
    choices: [],
    placeholder: "Describe the issue",
    submitLabel: "Continue",
    escalationLabel: "",
    resolution: null,
  },
  "login-escalate": {
    id: "login-escalate",
    kind: "escalate",
    messages: ["I can send this case to support."],
    choices: [],
    placeholder: "",
    submitLabel: "",
    escalationLabel: "Contact support",
    resolution: "needs_handoff",
  },
  "other-escalate": {
    id: "other-escalate",
    kind: "escalate",
    messages: ["I can send this case to support."],
    choices: [],
    placeholder: "",
    submitLabel: "",
    escalationLabel: "Contact support",
    resolution: "needs_handoff",
  },
  resolved: {
    id: "resolved",
    kind: "terminal",
    messages: ["Glad that helped."],
    choices: [],
    placeholder: "",
    submitLabel: "",
    escalationLabel: "",
    resolution: "resolved",
  },
};

let mockSupportSession: SupportSessionState | null = null;
let mockSupportThread: SupportThreadState | null = null;
let mockSupportMessages: SupportMessage[] = [];
let mockSupportTranscript: SupportTranscriptEvent[] = [];

function createMockSupportEvent(
  event_type: SupportTranscriptEvent["event_type"],
  node_id: string | null,
  payload: Record<string, unknown>,
): SupportTranscriptEvent {
  return {
    id: crypto.randomUUID(),
    event_type,
    node_id,
    payload,
    created_at: new Date().toISOString(),
  };
}

function getMockSupportNode(nodeId: string | null | undefined): SupportNodeState | null {
  return nodeId ? mockSupportNodes[nodeId] || null : null;
}

function getMockSupportState(): SupportStateResponse {
  return {
    platformAdmin: true,
    thread: mockSupportThread,
    messages: mockSupportMessages,
    session: mockSupportThread ? null : mockSupportSession,
    transcript: mockSupportThread ? [] : mockSupportTranscript,
    currentNode: mockSupportThread ? null : getMockSupportNode(mockSupportSession?.current_node_id),
  };
}

function getMockEscalateNodeId(nodeId: string): string {
  return nodeId.replace(/-details$/, "-escalate");
}

async function requestSupportJson<T extends object>(
  path: string,
  init?: RequestInit,
): Promise<SupportApiResult<T>> {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({})) as T;
  return { ...data, _status: res.status };
}

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
  const res = await fetch(`/api/data?${params}`, {
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

export async function submitModerationPetition(channelId: string, text: string) {
  if (IS_MOCK) return { ok: true };
  return adminAction("submit-moderation-petition", channelId, { text });
}

export async function fetchSupportState() {
  if (IS_MOCK) return { ...getMockSupportState(), _status: 200 };
  return requestSupportJson<SupportStateResponse>("/api/support", {
    cache: "no-store",
  });
}

export async function startSupportSession() {
  if (IS_MOCK) {
    if (mockSupportThread) {
      return { ...getMockSupportState(), _status: 200 };
    }
    if (!mockSupportSession) {
      const createdAt = new Date().toISOString();
      mockSupportSession = {
        id: crypto.randomUUID(),
        status: "open",
        entry_topic: null,
        entry_topic_label: "Support",
        current_node_id: "start",
        resolved_via_tree: false,
        escalated_thread_id: null,
        created_at: createdAt,
        updated_at: createdAt,
        completed_at: null,
      };
      mockSupportTranscript = mockSupportNodes.start.messages.map((message) =>
        createMockSupportEvent("bot_message", "start", { text: message })
      );
    }
    return { ...getMockSupportState(), _status: 200 };
  }
  return requestSupportJson<SupportStateResponse>("/api/support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start_session" }),
  });
}

export async function answerSupportSession(payload: {
  session_id: string;
  choice_id?: string;
  text?: string;
}) {
  if (IS_MOCK) {
    if (!mockSupportSession) return { error: "session_not_found", _status: 404 };
    const currentNode = getMockSupportNode(mockSupportSession.current_node_id);
    if (!currentNode) return { error: "invalid_state", _status: 409 };
    const createdAt = new Date().toISOString();
    let nextNodeId = mockSupportSession.current_node_id;
    let entryTopic = mockSupportSession.entry_topic;

    if (currentNode.kind === "choice") {
      const choice = currentNode.choices.find((item) => item.id === payload.choice_id);
      if (!choice) return { error: "invalid_choice", _status: 400 };
      nextNodeId = choice.next;
      entryTopic = choice.topic || entryTopic;
      mockSupportTranscript = [
        ...mockSupportTranscript,
        createMockSupportEvent("user_choice", currentNode.id, {
          choice_id: choice.id,
          label: choice.label,
        }),
      ];
    } else if (currentNode.kind === "text") {
      const text = payload.text?.trim();
      if (!text) return { error: "text_required", _status: 400 };
      nextNodeId = getMockEscalateNodeId(currentNode.id);
      mockSupportTranscript = [
        ...mockSupportTranscript,
        createMockSupportEvent("user_text", currentNode.id, { text }),
      ];
    }

    const nextNode = getMockSupportNode(nextNodeId);
    if (!nextNode) return { error: "flow_not_found", _status: 500 };
    mockSupportSession = {
      ...mockSupportSession,
      entry_topic: entryTopic,
      entry_topic_label: entryTopic === "login" ? "Login or account" : entryTopic === "other" ? "Other" : "Support",
      current_node_id: nextNode.id,
      status: nextNode.kind === "terminal" ? "resolved" : "open",
      resolved_via_tree: nextNode.kind === "terminal",
      updated_at: createdAt,
      completed_at: nextNode.kind === "terminal" ? createdAt : null,
    };
    mockSupportTranscript = [
      ...mockSupportTranscript,
      ...nextNode.messages.map((message) => createMockSupportEvent("bot_message", nextNode.id, { text: message })),
    ];
    return {
      thread: null,
      messages: [],
      session: mockSupportSession,
      transcript: mockSupportTranscript,
      currentNode: nextNode,
      _status: 200,
    };
  }
  return requestSupportJson<SupportStateResponse>("/api/support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "answer_session",
      ...payload,
    }),
  });
}

export async function escalateSupportSession(sessionId: string) {
  if (IS_MOCK) {
    if (!mockSupportSession) return { error: "session_not_found", _status: 404 };
    const createdAt = new Date().toISOString();
    mockSupportThread = {
      id: crypto.randomUUID(),
      user_id: "mock-user",
      source_session_id: mockSupportSession.id,
      entry_topic: mockSupportSession.entry_topic,
      entry_topic_label: mockSupportSession.entry_topic_label,
      summary: "Mock support summary",
      status: "open",
      created_at: createdAt,
      updated_at: createdAt,
      closed_at: null,
      closed_by: null,
      user_name: "Mock User",
      user_email: "mock@example.com",
      last_message: "Mock support summary",
    };
    mockSupportMessages = [{
      id: crypto.randomUUID(),
      thread_id: mockSupportThread.id,
      sender_role: "user",
      sender_user_id: "mock-user",
      text: mockSupportThread.summary,
      created_at: createdAt,
    }];
    mockSupportTranscript = [
      ...mockSupportTranscript,
      createMockSupportEvent("escalation", mockSupportSession.current_node_id, {
        thread_id: mockSupportThread.id,
        summary: mockSupportThread.summary,
      }),
    ];
    mockSupportSession = {
      ...mockSupportSession,
      status: "escalated",
      escalated_thread_id: mockSupportThread.id,
      updated_at: createdAt,
      completed_at: createdAt,
    };
    return {
      thread: mockSupportThread,
      messages: mockSupportMessages,
      _status: 200,
    };
  }
  return requestSupportJson<PlatformSupportThreadResponse>("/api/support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "escalate_session",
      session_id: sessionId,
    }),
  });
}

export async function sendSupportThreadMessage(threadId: string, text: string) {
  if (IS_MOCK) {
    if (!mockSupportThread) return { error: "thread_not_found", _status: 404 };
    const message = {
      id: crypto.randomUUID(),
      thread_id: threadId,
      sender_role: "user" as const,
      sender_user_id: "mock-user",
      text,
      created_at: new Date().toISOString(),
    };
    mockSupportMessages = [...mockSupportMessages, message];
    mockSupportThread = {
      ...mockSupportThread,
      updated_at: message.created_at,
      last_message: text,
    };
    return { ok: true, message, _status: 200 };
  }
  return requestSupportJson<{
    ok?: boolean;
    message?: SupportMessage;
    error?: string;
  }>("/api/support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "send_thread_message",
      thread_id: threadId,
      text,
    }),
  });
}

export async function fetchPlatformSupportThreads() {
  if (IS_MOCK) {
    return {
      threads: mockSupportThread ? [mockSupportThread] : [],
      _status: 200,
    };
  }
  return requestSupportJson<PlatformSupportThreadsResponse>("/api/platform-admin/support?type=threads", {
    cache: "no-store",
  });
}

export async function fetchPlatformSupportThread(threadId: string) {
  if (IS_MOCK) {
    return {
      thread: mockSupportThread?.id === threadId ? mockSupportThread : null,
      messages: mockSupportThread?.id === threadId ? mockSupportMessages : [],
      _status: mockSupportThread?.id === threadId ? 200 : 404,
    };
  }
  return requestSupportJson<PlatformSupportThreadResponse>(`/api/platform-admin/support?type=thread&thread_id=${encodeURIComponent(threadId)}`, {
    cache: "no-store",
  });
}

export async function fetchPlatformSupportSession(sessionId: string) {
  if (IS_MOCK) {
    return {
      session: mockSupportSession?.id === sessionId ? mockSupportSession : null,
      transcript: mockSupportSession?.id === sessionId ? mockSupportTranscript : [],
      currentNode: mockSupportSession?.id === sessionId ? getMockSupportNode(mockSupportSession.current_node_id) : null,
      _status: mockSupportSession?.id === sessionId ? 200 : 404,
    };
  }
  return requestSupportJson<PlatformSupportSessionResponse>(`/api/platform-admin/support?type=session&session_id=${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
  });
}

export async function sendPlatformSupportMessage(threadId: string, text: string) {
  if (IS_MOCK) {
    if (!mockSupportThread) return { error: "thread_not_found", _status: 404 };
    const message = {
      id: crypto.randomUUID(),
      thread_id: threadId,
      sender_role: "platform_admin" as const,
      sender_user_id: "mock-admin",
      text,
      created_at: new Date().toISOString(),
    };
    mockSupportMessages = [...mockSupportMessages, message];
    mockSupportThread = {
      ...mockSupportThread,
      updated_at: message.created_at,
      last_message: text,
    };
    return { ok: true, message, _status: 200 };
  }
  return requestSupportJson<{
    ok?: boolean;
    message?: SupportMessage;
    error?: string;
  }>("/api/platform-admin/support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "send_message",
      thread_id: threadId,
      text,
    }),
  });
}

export async function closePlatformSupportThread(threadId: string) {
  if (IS_MOCK) {
    if (!mockSupportThread) return { error: "thread_not_found", _status: 404 };
    mockSupportThread = null;
    mockSupportMessages = [];
    mockSupportSession = null;
    mockSupportTranscript = [];
    return { ok: true, _status: 200 };
  }
  return requestSupportJson<{
    ok?: boolean;
    error?: string;
  }>("/api/platform-admin/support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "close_thread",
      thread_id: threadId,
    }),
  });
}

export async function sendMessage(payload: {
  uid: string;
  nick?: string;
  text: string;
  channel_id: string;
  image?: string;
  upload_id?: string;
  reply_to?: string;
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
  const res = await fetch(`/api/data?${params}`, {
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
