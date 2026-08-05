import { en, ko } from "./locales";

const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === "true";
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
type UploadPurpose = "message" | "dm" | "channel-asset";
type UploadResult = { url: string; uploadId?: string };

type SupportNodeKind = "choice" | "text" | "escalate" | "terminal";
type SupportSessionStatus = "open" | "resolved" | "escalated" | "abandoned";
type SupportThreadStatus = "open" | "closed";
type AppLocale = "ko" | "en";
type SupportMockLocaleKey =
  | "supportMockStartPrompt"
  | "supportMockTopicLogin"
  | "supportMockTopicOther"
  | "supportMockLoginDetails"
  | "supportMockOtherDetails"
  | "supportMockDescribeIssue"
  | "supportMockContinue"
  | "supportMockEscalatePrompt"
  | "supportMockContactSupport"
  | "supportMockResolved"
  | "supportMockSummary"
  | "supportMockUserName"
  | "supportMockTicketClosed";

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
  requires_user_acknowledgement: boolean;
  user_name: string | null;
  user_email: string | null;
  last_message: string | null;
  has_admin_reply: boolean;
  can_user_send: boolean;
  actor_type: "guest" | "logged_in";
  waiting_on: "user" | "platform_admin" | null;
  last_action: "ticket_created" | "user_replied" | "admin_replied" | "user_closed" | "admin_closed";
  unread_for_user: boolean;
  unread_for_admin: boolean;
  stale_level: "none" | "stale" | "critical";
  open_duration_minutes: number;
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

export interface SupportPreviewResponse {
  error?: string;
  thread: SupportThreadState | null;
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

export interface PlatformDashboardReportsInbox {
  channel_id: string;
  name: string;
  profile_image: string | null;
  bubble_color: string;
  open_report_count: number;
  oldest_report_at: string | null;
  created_at: string;
}

export interface PlatformDashboardTicketPreview extends SupportThreadState {
  user_label: string;
  has_admin_reply: boolean;
}

export interface PlatformDashboardSupportStats {
  open_count: number;
  waiting_for_admin_count: number;
  waiting_for_user_count: number;
  unread_for_admin_count: number;
  stale_24h_count: number;
  stale_72h_count: number;
  oldest_open_duration_minutes: number;
}

export interface PlatformDashboardResponse {
  error?: string;
  reportsInbox: PlatformDashboardReportsInbox | null;
  tickets: PlatformDashboardTicketPreview[];
  open_pagination?: {
    has_more: boolean;
    next_cursor: string | null;
  } | null;
  support_stats?: PlatformDashboardSupportStats | null;
}

export interface PlatformOperationalHealthWindow {
  tracked_event_count: number;
  request_5xx_count: number;
  unhandled_exception_count: number;
  maintenance_failure_count: number;
  rate_limited_count: number;
  forbidden_count: number;
}

export interface PlatformOperationalHealthRoute extends PlatformOperationalHealthWindow {
  route: string;
  last_event_at: string;
}

export interface PlatformOperationalHealthResponse {
  error?: string;
  generated_at: string;
  status: "healthy" | "degraded" | "critical";
  windows: {
    last_15m: PlatformOperationalHealthWindow;
    last_24h: PlatformOperationalHealthWindow;
  };
  routes: PlatformOperationalHealthRoute[];
}

export interface StoredSupportTicketPreview {
  threadId: string;
  topicLabel: string;
  preview: string;
  updatedAt: string;
  unreadForUser?: boolean;
  waitingOn?: "user" | "platform_admin" | null;
  staleLevel?: "none" | "stale" | "critical";
}

type SupportApiResult<T extends object> = T & { _status: number };
const SUPPORT_TICKET_PREVIEW_STORAGE_KEY = "letmetellu_support_ticket_preview";

let mockSupportSession: SupportSessionState | null = null;
type MockSupportThreadState = Omit<
  SupportThreadState,
  "actor_type" | "waiting_on" | "last_action" | "unread_for_user" | "unread_for_admin" | "stale_level" | "open_duration_minutes"
>;

let mockSupportThread: MockSupportThreadState | null = null;
let mockSupportMessages: SupportMessage[] = [];
let mockSupportTranscript: SupportTranscriptEvent[] = [];
let mockSupportReadState: { user: string | null; platform_admin: string | null } = {
  user: null,
  platform_admin: null,
};

function getCurrentLocale(): AppLocale {
  if (typeof window === "undefined") return "ko";
  try {
    const savedLocale = localStorage.getItem("locale");
    if (savedLocale === "ko" || savedLocale === "en") {
      return savedLocale;
    }
  } catch {}
  return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

function supportRequestHeaders(headers?: HeadersInit): HeadersInit {
  const locale = getCurrentLocale();
  if (!headers) {
    return { "X-Locale": locale };
  }
  if (headers instanceof Headers) {
    const next = new Headers(headers);
    next.set("X-Locale", locale);
    return next;
  }
  if (Array.isArray(headers)) {
    const next = new Headers(headers);
    next.set("X-Locale", locale);
    return next;
  }
  return {
    ...headers,
    "X-Locale": locale,
  };
}

function getMockSupportText(key: SupportMockLocaleKey): string {
  const locale = getCurrentLocale();
  const locales = locale === "en" ? en : ko;
  return locales[key];
}

function getMockSupportTopicLabel(topic: string | null): string {
  if (topic === "login") return getMockSupportText("supportMockTopicLogin");
  if (topic === "other") return getMockSupportText("supportMockTopicOther");
  return getCurrentLocale() === "en" ? en.supportTitle : ko.supportTitle;
}

function buildMockSupportNodes(): Record<string, SupportNodeState> {
  return {
    start: {
      id: "start",
      kind: "choice",
      messages: [getMockSupportText("supportMockStartPrompt")],
      choices: [
        { id: "topic-login", label: getMockSupportText("supportMockTopicLogin"), next: "login-details", topic: "login" },
        { id: "topic-other", label: getMockSupportText("supportMockTopicOther"), next: "other-details", topic: "other" },
      ],
      placeholder: "",
      submitLabel: "",
      escalationLabel: "",
      resolution: null,
    },
    "login-details": {
      id: "login-details",
      kind: "text",
      messages: [getMockSupportText("supportMockLoginDetails")],
      choices: [],
      placeholder: getMockSupportText("supportMockDescribeIssue"),
      submitLabel: getMockSupportText("supportMockContinue"),
      escalationLabel: "",
      resolution: null,
    },
    "other-details": {
      id: "other-details",
      kind: "text",
      messages: [getMockSupportText("supportMockOtherDetails")],
      choices: [],
      placeholder: getMockSupportText("supportMockDescribeIssue"),
      submitLabel: getMockSupportText("supportMockContinue"),
      escalationLabel: "",
      resolution: null,
    },
    "login-escalate": {
      id: "login-escalate",
      kind: "escalate",
      messages: [getMockSupportText("supportMockEscalatePrompt")],
      choices: [],
      placeholder: "",
      submitLabel: "",
      escalationLabel: getMockSupportText("supportMockContactSupport"),
      resolution: "needs_handoff",
    },
    "other-escalate": {
      id: "other-escalate",
      kind: "escalate",
      messages: [getMockSupportText("supportMockEscalatePrompt")],
      choices: [],
      placeholder: "",
      submitLabel: "",
      escalationLabel: getMockSupportText("supportMockContactSupport"),
      resolution: "needs_handoff",
    },
    resolved: {
      id: "resolved",
      kind: "terminal",
      messages: [getMockSupportText("supportMockResolved")],
      choices: [],
      placeholder: "",
      submitLabel: "",
      escalationLabel: "",
      resolution: "resolved",
    },
  };
}

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
  const mockSupportNodes = buildMockSupportNodes();
  return nodeId ? mockSupportNodes[nodeId] || null : null;
}

function getMockSupportActorType(userId: string): "guest" | "logged_in" {
  return userId.startsWith("anon:") ? "guest" : "logged_in";
}

function getMockSupportWaitingOn(thread: MockSupportThreadState): "user" | "platform_admin" | null {
  if (thread.status !== "open") return null;
  const lastMessage = mockSupportMessages[mockSupportMessages.length - 1] || null;
  return lastMessage?.sender_role === "platform_admin" ? "user" : "platform_admin";
}

function getMockSupportLastAction(thread: MockSupportThreadState): SupportThreadState["last_action"] {
  if (thread.status === "closed") {
    return thread.closed_by === thread.user_id ? "user_closed" : "admin_closed";
  }
  const lastMessage = mockSupportMessages[mockSupportMessages.length - 1] || null;
  if (lastMessage?.sender_role === "platform_admin") return "admin_replied";
  if (lastMessage?.sender_role === "user" && thread.has_admin_reply) return "user_replied";
  return "ticket_created";
}

function getMockUnread(messageAt: string | null | undefined, readAt: string | null): boolean {
  if (!messageAt) return false;
  if (!readAt) return true;
  return new Date(messageAt).getTime() > new Date(readAt).getTime();
}

function getMockSupportThreadState(): SupportThreadState | null {
  if (!mockSupportThread) return null;
  const lastUserMessage = [...mockSupportMessages].reverse().find((message) => message.sender_role === "user") || null;
  const lastAdminMessage = [...mockSupportMessages].reverse().find((message) => message.sender_role === "platform_admin") || null;
  const ageMs = Math.max(0, Date.now() - new Date(mockSupportThread.updated_at).getTime());
  const staleLevel = mockSupportThread.status !== "open"
    ? "none"
    : ageMs >= 72 * 60 * 60 * 1000
      ? "critical"
      : ageMs >= 24 * 60 * 60 * 1000
        ? "stale"
        : "none";

  return {
    ...mockSupportThread,
    actor_type: getMockSupportActorType(mockSupportThread.user_id),
    waiting_on: getMockSupportWaitingOn(mockSupportThread),
    last_action: getMockSupportLastAction(mockSupportThread),
    unread_for_user: getMockUnread(lastAdminMessage?.created_at, mockSupportReadState.user),
    unread_for_admin: getMockUnread(lastUserMessage?.created_at, mockSupportReadState.platform_admin),
    stale_level: staleLevel,
    open_duration_minutes: Math.max(0, Math.floor((Date.now() - new Date(mockSupportThread.created_at).getTime()) / 60_000)),
  };
}

function getMockSupportState(): SupportStateResponse {
  const thread = getMockSupportThreadState();
  const isVisible = thread?.status === "open" || thread?.requires_user_acknowledgement;
  return {
    platformAdmin: true,
    thread: isVisible ? thread : null,
    messages: isVisible ? mockSupportMessages : [],
    session: mockSupportSession,
    transcript: mockSupportSession ? mockSupportTranscript : [],
    currentNode: getMockSupportNode(mockSupportSession?.current_node_id),
  };
}

function getMockSupportPreview(): SupportPreviewResponse {
  const thread = getMockSupportThreadState();
  return {
    thread: thread?.status === "open" || thread?.requires_user_acknowledgement ? thread : null,
  };
}

function getMockEscalateNodeId(nodeId: string): string {
  return nodeId.replace(/-details$/, "-escalate");
}

function createMockEscalatedSupportThread() {
  if (!mockSupportSession) {
    return { error: "session_not_found", _status: 404 } as const;
  }

  const createdAt = new Date().toISOString();
  if (mockSupportThread) {
    mockSupportTranscript = [
      ...mockSupportTranscript,
      createMockSupportEvent("escalation", mockSupportSession.current_node_id, {
        thread_id: mockSupportThread.id,
        reused_existing_thread: true,
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
      thread: getMockSupportThreadState(),
      messages: mockSupportMessages,
      _status: 200,
    } as const;
  }

  mockSupportThread = {
    id: crypto.randomUUID(),
    user_id: "mock-user",
    source_session_id: mockSupportSession.id,
    entry_topic: mockSupportSession.entry_topic,
    entry_topic_label: mockSupportSession.entry_topic_label,
    summary: getMockSupportText("supportMockSummary"),
    status: "open",
    created_at: createdAt,
    updated_at: createdAt,
    closed_at: null,
    closed_by: null,
    requires_user_acknowledgement: false,
    user_name: getMockSupportText("supportMockUserName"),
    user_email: "mock@example.com",
    last_message: getMockSupportText("supportMockSummary"),
    has_admin_reply: false,
    can_user_send: false,
  };
  mockSupportMessages = [{
    id: crypto.randomUUID(),
    thread_id: mockSupportThread.id,
    sender_role: "user",
    sender_user_id: "mock-user",
    text: mockSupportThread.summary,
    created_at: createdAt,
  }];
  mockSupportReadState = {
    user: createdAt,
    platform_admin: null,
  };
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
    thread: getMockSupportThreadState(),
    messages: mockSupportMessages,
    _status: 200,
  } as const;
}

async function requestSupportJson<T extends object>(
  path: string,
  init?: RequestInit,
): Promise<SupportApiResult<T>> {
  const res = await fetch(path, {
    ...init,
    headers: supportRequestHeaders(init?.headers),
  });
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

// Room access management
export function notifyRoomAccessGranted(channelId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`roomToken_${channelId}`);
  window.dispatchEvent(new CustomEvent("room-token-changed", {
    detail: { channelId, hasAccess: true },
  }));
}

export function clearRoomToken(channelId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`roomToken_${channelId}`);
  void fetch(`/api/room-token?channel=${encodeURIComponent(channelId)}`, {
    method: "DELETE",
    cache: "no-store",
  }).catch(() => {});
  window.dispatchEvent(new CustomEvent("room-token-changed", {
    detail: { channelId, hasAccess: false },
  }));
}

export function setAnonymousIdentity(uid: string) {
  localStorage.setItem("letsplay_uid", uid);
  window.dispatchEvent(new CustomEvent("anonymous-identity-changed", {
    detail: { uid },
  }));
}

export function readStoredSupportTicketPreview(): StoredSupportTicketPreview | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SUPPORT_TICKET_PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSupportTicketPreview;
    if (
      !parsed
      || typeof parsed.threadId !== "string"
      || typeof parsed.topicLabel !== "string"
      || typeof parsed.preview !== "string"
      || typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function storeSupportTicketPreview(preview: StoredSupportTicketPreview) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SUPPORT_TICKET_PREVIEW_STORAGE_KEY, JSON.stringify(preview));
  } catch {}
}

export function clearStoredSupportTicketPreview() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SUPPORT_TICKET_PREVIEW_STORAGE_KEY);
  } catch {}
}

function roomTokenHeaders(_channelId: string): Record<string, string> {
  return {};
}

function buildDirectMediaUrl(
  mediaUrl: string | null | undefined,
  options?: { keepSameOrigin?: boolean },
): string | null {
  if (!mediaUrl) return null;

  try {
    const parsed = new URL(mediaUrl, WORKER_URL);
    if (!parsed.pathname.startsWith("/api/media/")) return mediaUrl;
    if (parsed.searchParams.has("media_token")) {
      return parsed.toString();
    }

    if (options?.keepSameOrigin) {
      return `${parsed.pathname}${parsed.search}`;
    }

    const direct = new URL(parsed.pathname, WORKER_URL);
    parsed.searchParams.forEach((value, key) => {
      if (key !== "token") direct.searchParams.append(key, value);
    });

    return direct.toString();
  } catch {
    return mediaUrl;
  }
}

export function decorateMediaUrl(mediaUrl: string | null | undefined): string | null {
  return buildDirectMediaUrl(mediaUrl);
}

export function decorateProtectedMediaUrl(mediaUrl: string | null | undefined): string | null {
  return buildDirectMediaUrl(mediaUrl, { keepSameOrigin: true });
}

export function decorateMessageMedia<T extends { image?: string | null }>(message: T): T {
  if (!message.image) return message;
  const image = decorateProtectedMediaUrl(message.image);
  return image === message.image ? message : { ...message, image };
}

function decorateChannelMedia<T extends { profile_image?: string | null; background_image?: string | null }>(channel: T): T {
  const profile_image = decorateMediaUrl(channel.profile_image);
  const background_image = decorateProtectedMediaUrl(channel.background_image);
  if (profile_image === channel.profile_image && background_image === channel.background_image) return channel;
  return { ...channel, profile_image, background_image };
}

export function decorateWelcomeConfig(config: string | undefined): string | undefined {
  if (!config) return config;
  try {
    const parsed = JSON.parse(config) as { icon?: unknown };
    if (typeof parsed.icon !== "string") return config;
    const icon = decorateProtectedMediaUrl(parsed.icon);
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

  // Always use the same-origin proxy. Auth.js session cookies are HttpOnly, so
  // channel-access cookies and session cookies stay server-readable only.
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

export async function verifyPasscode(channelId: string, passcode: string): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch("/api/verify-passcode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel_id: channelId, passcode }),
    cache: "no-store",
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
      image: decorateProtectedMediaUrl(item.image) || item.image,
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

export async function fetchSupportPreview() {
  if (IS_MOCK) return { ...getMockSupportPreview(), _status: 200 };
  return requestSupportJson<SupportPreviewResponse>("/api/support?type=preview", {
    cache: "no-store",
  });
}

export async function startSupportSession() {
  if (IS_MOCK) {
    if (!mockSupportSession) {
      const mockSupportNodes = buildMockSupportNodes();
      const createdAt = new Date().toISOString();
      mockSupportSession = {
        id: crypto.randomUUID(),
        status: "open",
        entry_topic: null,
        entry_topic_label: getMockSupportTopicLabel(null),
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
    if (nextNode.kind === "escalate") {
      mockSupportSession = {
        ...mockSupportSession,
        entry_topic: entryTopic,
        entry_topic_label: getMockSupportTopicLabel(entryTopic),
        current_node_id: nextNode.id,
        updated_at: createdAt,
      };
      return createMockEscalatedSupportThread();
    }
    mockSupportSession = {
      ...mockSupportSession,
      entry_topic: entryTopic,
      entry_topic_label: getMockSupportTopicLabel(entryTopic),
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
    return createMockEscalatedSupportThread();
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
    if (!mockSupportThread.can_user_send) {
      return { error: "await_admin_reply", _status: 409 };
    }
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
      can_user_send: false,
    };
    mockSupportReadState.user = message.created_at;
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

export async function closeSupportThread(threadId: string) {
  if (IS_MOCK) {
    if (!mockSupportThread) return { error: "thread_not_found", _status: 404 };
    mockSupportThread = {
      ...mockSupportThread,
      status: "closed",
      updated_at: new Date().toISOString(),
      closed_at: new Date().toISOString(),
      closed_by: mockSupportThread.user_id,
      requires_user_acknowledgement: false,
    };
    mockSupportReadState.user = mockSupportThread.updated_at;
    mockSupportMessages = [];
    mockSupportSession = null;
    mockSupportTranscript = [];
    return { ok: true, _status: 200 };
  }
  return requestSupportJson<{
    ok?: boolean;
    error?: string;
  }>("/api/support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "close_thread",
      thread_id: threadId,
    }),
  });
}

export async function markSupportThreadRead(threadId: string) {
  if (IS_MOCK) {
    if (mockSupportThread?.id === threadId) {
      mockSupportReadState.user = new Date().toISOString();
    }
    return { ok: true, _status: 200 };
  }
  return requestSupportJson<{
    ok?: boolean;
    error?: string;
  }>("/api/support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "mark_thread_read",
      thread_id: threadId,
    }),
  });
}

export async function acknowledgeSupportThreadClosure(threadId: string) {
  if (IS_MOCK) {
    if (mockSupportThread?.id === threadId) {
      mockSupportThread = null;
      mockSupportMessages = [];
    }
    return { ok: true, _status: 200 };
  }
  return requestSupportJson<{
    ok?: boolean;
    error?: string;
  }>("/api/support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "acknowledge_closure",
      thread_id: threadId,
    }),
  });
}

export async function clearSupportSession(sessionId: string) {
  if (IS_MOCK) {
    if (mockSupportSession?.id === sessionId && mockSupportSession.status === "open") {
      mockSupportSession = null;
      mockSupportTranscript = [];
    }
    return { ok: true, _status: 200 };
  }
  return requestSupportJson<{
    ok?: boolean;
    error?: string;
  }>("/api/support", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "clear_session",
      session_id: sessionId,
    }),
  });
}

export async function fetchPlatformDashboard(openCursor?: string | null) {
  if (IS_MOCK) {
    const thread = getMockSupportThreadState();
    const openTickets = thread && thread.status === "open" ? [thread] : [];
    return {
      reportsInbox: null,
      tickets: thread ? [{
        ...thread,
        user_label: thread.user_name || thread.user_email || thread.user_id,
        has_admin_reply: thread.has_admin_reply,
      }] : [],
      support_stats: {
        open_count: openTickets.length,
        waiting_for_admin_count: openTickets.filter((item) => item.waiting_on === "platform_admin").length,
        waiting_for_user_count: openTickets.filter((item) => item.waiting_on === "user").length,
        unread_for_admin_count: openTickets.filter((item) => item.unread_for_admin).length,
        stale_24h_count: openTickets.filter((item) => item.stale_level !== "none").length,
        stale_72h_count: openTickets.filter((item) => item.stale_level === "critical").length,
        oldest_open_duration_minutes: openTickets.reduce((max, item) => Math.max(max, item.open_duration_minutes), 0),
      },
      open_pagination: { has_more: false, next_cursor: null },
      _status: 200,
    };
  }
  const params = new URLSearchParams({ type: "dashboard" });
  if (openCursor) params.set("open_cursor", openCursor);
  return requestSupportJson<PlatformDashboardResponse>(`/api/platform-admin/support?${params.toString()}`, {
    cache: "no-store",
  });
}

export async function fetchPlatformOperationalHealth() {
  if (IS_MOCK) {
    const emptyWindow: PlatformOperationalHealthWindow = {
      tracked_event_count: 0,
      request_5xx_count: 0,
      unhandled_exception_count: 0,
      maintenance_failure_count: 0,
      rate_limited_count: 0,
      forbidden_count: 0,
    };
    return {
      generated_at: new Date().toISOString(),
      status: "healthy" as const,
      windows: { last_15m: emptyWindow, last_24h: emptyWindow },
      routes: [],
      _status: 200,
    };
  }
  return requestSupportJson<PlatformOperationalHealthResponse>("/api/platform-admin/support?type=health", {
    cache: "no-store",
  });
}

export async function fetchPlatformSupportThread(threadId: string) {
  if (IS_MOCK) {
    const thread = getMockSupportThreadState();
    return {
      thread: thread?.id === threadId ? thread : null,
      messages: thread?.id === threadId ? mockSupportMessages : [],
      _status: thread?.id === threadId ? 200 : 404,
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
      has_admin_reply: true,
      can_user_send: true,
    };
    mockSupportReadState.platform_admin = message.created_at;
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

export async function markPlatformSupportThreadRead(threadId: string) {
  if (IS_MOCK) {
    if (mockSupportThread?.id === threadId) {
      mockSupportReadState.platform_admin = new Date().toISOString();
    }
    return { ok: true, _status: 200 };
  }
  return requestSupportJson<{
    ok?: boolean;
    error?: string;
  }>("/api/platform-admin/support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "mark_thread_read",
      thread_id: threadId,
    }),
  });
}

export async function closePlatformSupportThread(threadId: string) {
  if (IS_MOCK) {
    if (!mockSupportThread) return { error: "thread_not_found", _status: 404 };
    mockSupportThread = {
      ...mockSupportThread,
      status: "closed",
      updated_at: new Date().toISOString(),
      closed_at: new Date().toISOString(),
      closed_by: "mock-admin",
      requires_user_acknowledgement: true,
    };
    mockSupportMessages = [
      ...mockSupportMessages,
      {
        id: crypto.randomUUID(),
        thread_id: threadId,
        sender_role: "platform_admin",
        sender_user_id: "mock-admin",
        text: getMockSupportText("supportMockTicketClosed"),
        created_at: mockSupportThread.updated_at,
      },
    ];
    mockSupportReadState.platform_admin = mockSupportThread.updated_at;
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

export interface MessageSearchCursor {
  created_at: string;
  id: string;
}

export interface MessageSearchResult {
  id: string;
  text: string;
  created_at: string;
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
  const parentChannelId = getParentChannelId(channelId);
  const params = new URLSearchParams({ type: "search", channel: channelId, q: query });
  if (cursor) {
    params.set("cursor", cursor.created_at);
    params.set("cursor_id", cursor.id);
  }
  const res = await fetch(`/api/data?${params}`, {
    headers: roomTokenHeaders(parentChannelId),
  });
  if (!res.ok) throw new Error(`Message search failed: ${res.status}`);
  return res.json() as Promise<MessageSearchResponse>;
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
