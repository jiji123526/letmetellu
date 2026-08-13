import { en, ko } from "./locales";
import type {
  PlatformDashboardResponse,
  PlatformOperationalHealthResponse,
  PlatformOperationalHealthWindow,
  PlatformSupportSessionResponse,
  PlatformSupportThreadResponse,
  SupportApiResult,
  SupportMessage,
  SupportNodeState,
  SupportPreviewResponse,
  SupportSessionState,
  SupportStateResponse,
  SupportThreadState,
  SupportTranscriptEvent,
} from "./api-support-types";

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

type MockSupportThreadState = Omit<
  SupportThreadState,
  "actor_type" | "waiting_on" | "last_action" | "unread_for_user" | "unread_for_admin" | "stale_level" | "open_duration_minutes"
>;

let mockSupportSession: SupportSessionState | null = null;
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

export function getMockSupportState(): SupportStateResponse {
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

export function getMockSupportPreview(): SupportPreviewResponse {
  const thread = getMockSupportThreadState();
  return {
    thread: thread?.status === "open" || thread?.requires_user_acknowledgement ? thread : null,
  };
}

function getMockEscalateNodeId(nodeId: string): string {
  return nodeId.replace(/-details$/, "-escalate");
}

function createMockEscalatedSupportThread(): SupportApiResult<PlatformSupportThreadResponse> {
  if (!mockSupportSession) {
    return { error: "session_not_found", thread: null, messages: [], _status: 404 };
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
    };
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
  };
}

export function startMockSupportSession(): SupportApiResult<SupportStateResponse> {
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

export function answerMockSupportSession(payload: {
  session_id: string;
  choice_id?: string;
  text?: string;
}): SupportApiResult<SupportStateResponse> | SupportApiResult<PlatformSupportThreadResponse> {
  if (!mockSupportSession) return { error: "session_not_found", thread: null, messages: [], session: null, transcript: [], currentNode: null, _status: 404 };
  const currentNode = getMockSupportNode(mockSupportSession.current_node_id);
  if (!currentNode) return { error: "invalid_state", thread: null, messages: [], session: null, transcript: [], currentNode: null, _status: 409 };
  const createdAt = new Date().toISOString();
  let nextNodeId = mockSupportSession.current_node_id;
  let entryTopic = mockSupportSession.entry_topic;

  if (currentNode.kind === "choice") {
    const choice = currentNode.choices.find((item) => item.id === payload.choice_id);
    if (!choice) return { error: "invalid_choice", thread: null, messages: [], session: null, transcript: [], currentNode: null, _status: 400 };
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
    if (!text) return { error: "text_required", thread: null, messages: [], session: null, transcript: [], currentNode: null, _status: 400 };
    nextNodeId = getMockEscalateNodeId(currentNode.id);
    mockSupportTranscript = [
      ...mockSupportTranscript,
      createMockSupportEvent("user_text", currentNode.id, { text }),
    ];
  }

  const nextNode = getMockSupportNode(nextNodeId);
  if (!nextNode) return { error: "flow_not_found", thread: null, messages: [], session: null, transcript: [], currentNode: null, _status: 500 };
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

export function escalateMockSupportSession(): SupportApiResult<PlatformSupportThreadResponse> {
  if (!mockSupportSession) {
    return { error: "session_not_found", thread: null, messages: [], _status: 404 };
  }
  return createMockEscalatedSupportThread();
}

export function sendMockSupportThreadMessage(threadId: string, text: string): SupportApiResult<{ ok?: boolean; message?: SupportMessage; error?: string }> {
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

export function closeMockSupportThread(): SupportApiResult<{ ok?: boolean; error?: string }> {
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

export function markMockSupportThreadRead(threadId: string): SupportApiResult<{ ok?: boolean; error?: string }> {
  if (mockSupportThread?.id === threadId) {
    mockSupportReadState.user = new Date().toISOString();
  }
  return { ok: true, _status: 200 };
}

export function acknowledgeMockSupportThreadClosure(threadId: string): SupportApiResult<{ ok?: boolean; error?: string }> {
  if (mockSupportThread?.id === threadId) {
    mockSupportThread = null;
    mockSupportMessages = [];
  }
  return { ok: true, _status: 200 };
}

export function clearMockSupportSession(sessionId: string): SupportApiResult<{ ok?: boolean; error?: string }> {
  if (mockSupportSession?.id === sessionId && mockSupportSession.status === "open") {
    mockSupportSession = null;
    mockSupportTranscript = [];
  }
  return { ok: true, _status: 200 };
}

export function fetchMockPlatformDashboard(): SupportApiResult<PlatformDashboardResponse> {
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

export function fetchMockPlatformOperationalHealth(): SupportApiResult<PlatformOperationalHealthResponse> {
  const emptyWindow: PlatformOperationalHealthWindow = {
    tracked_event_count: 0,
    request_5xx_count: 0,
    preview_upstream_failure_count: 0,
    unhandled_exception_count: 0,
    maintenance_failure_count: 0,
    cleanup_failure_count: 0,
    realtime_failure_count: 0,
    rate_limited_count: 0,
    forbidden_count: 0,
    media_not_found_count: 0,
  };
  return {
    generated_at: new Date().toISOString(),
    status: "healthy",
    windows: { last_15m: emptyWindow, last_24h: emptyWindow },
    routes: [],
    _status: 200,
  };
}

export function fetchMockPlatformSupportThread(threadId: string): SupportApiResult<PlatformSupportThreadResponse> {
  const thread = getMockSupportThreadState();
  return {
    thread: thread?.id === threadId ? thread : null,
    messages: thread?.id === threadId ? mockSupportMessages : [],
    _status: thread?.id === threadId ? 200 : 404,
  };
}

export function fetchMockPlatformSupportSession(sessionId: string): SupportApiResult<PlatformSupportSessionResponse> {
  return {
    session: mockSupportSession?.id === sessionId ? mockSupportSession : null,
    transcript: mockSupportSession?.id === sessionId ? mockSupportTranscript : [],
    currentNode: mockSupportSession?.id === sessionId ? getMockSupportNode(mockSupportSession.current_node_id) : null,
    _status: mockSupportSession?.id === sessionId ? 200 : 404,
  };
}

export function sendMockPlatformSupportMessage(threadId: string, text: string): SupportApiResult<{ ok?: boolean; message?: SupportMessage; error?: string }> {
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

export function markMockPlatformSupportThreadRead(threadId: string): SupportApiResult<{ ok?: boolean; error?: string }> {
  if (mockSupportThread?.id === threadId) {
    mockSupportReadState.platform_admin = new Date().toISOString();
  }
  return { ok: true, _status: 200 };
}

export function closeMockPlatformSupportThread(threadId: string): SupportApiResult<{ ok?: boolean; error?: string }> {
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
