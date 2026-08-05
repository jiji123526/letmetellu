import { IS_MOCK } from "./api-core";
import type {
  PlatformDashboardResponse,
  PlatformOperationalHealthResponse,
  PlatformSupportSessionResponse,
  PlatformSupportThreadResponse,
  StoredSupportTicketPreview,
  SupportApiResult,
  SupportMessage,
  SupportPreviewResponse,
  SupportStateResponse,
} from "./api-support-types";

export type {
  PlatformDashboardResponse,
  PlatformDashboardSupportStats,
  PlatformOperationalHealthResponse,
  PlatformOperationalHealthRoute,
  PlatformOperationalHealthWindow,
  PlatformSupportSessionResponse,
  PlatformSupportThreadResponse,
  StoredSupportTicketPreview,
  SupportChoice,
  SupportMessage,
  SupportNodeState,
  SupportPreviewResponse,
  SupportSessionState,
  SupportStateResponse,
  SupportThreadState,
  SupportTranscriptEvent,
} from "./api-support-types";

const SUPPORT_TICKET_PREVIEW_STORAGE_KEY = "letmetellu_support_ticket_preview";

let supportMockApiPromise: Promise<typeof import("./api-support-mock")> | null = null;

function getCurrentLocale(): "ko" | "en" {
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

function loadSupportMockApi() {
  if (!supportMockApiPromise) {
    supportMockApiPromise = import("./api-support-mock");
  }
  return supportMockApiPromise;
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

export async function fetchSupportState() {
  if (IS_MOCK) {
    const mockApi = await loadSupportMockApi();
    return { ...mockApi.getMockSupportState(), _status: 200 };
  }
  return requestSupportJson<SupportStateResponse>("/api/support", {
    cache: "no-store",
  });
}

export async function fetchSupportPreview() {
  if (IS_MOCK) {
    const mockApi = await loadSupportMockApi();
    return { ...mockApi.getMockSupportPreview(), _status: 200 };
  }
  return requestSupportJson<SupportPreviewResponse>("/api/support?type=preview", {
    cache: "no-store",
  });
}

export async function startSupportSession() {
  if (IS_MOCK) {
    const mockApi = await loadSupportMockApi();
    return mockApi.startMockSupportSession();
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
    const mockApi = await loadSupportMockApi();
    return mockApi.answerMockSupportSession(payload);
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
    const mockApi = await loadSupportMockApi();
    return mockApi.escalateMockSupportSession();
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
    const mockApi = await loadSupportMockApi();
    return mockApi.sendMockSupportThreadMessage(threadId, text);
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
    const mockApi = await loadSupportMockApi();
    return mockApi.closeMockSupportThread();
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
    const mockApi = await loadSupportMockApi();
    return mockApi.markMockSupportThreadRead(threadId);
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
    const mockApi = await loadSupportMockApi();
    return mockApi.acknowledgeMockSupportThreadClosure(threadId);
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
    const mockApi = await loadSupportMockApi();
    return mockApi.clearMockSupportSession(sessionId);
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
    const mockApi = await loadSupportMockApi();
    return mockApi.fetchMockPlatformDashboard();
  }
  const params = new URLSearchParams({ type: "dashboard" });
  if (openCursor) params.set("open_cursor", openCursor);
  return requestSupportJson<PlatformDashboardResponse>(`/api/platform-admin/support?${params.toString()}`, {
    cache: "no-store",
  });
}

export async function fetchPlatformOperationalHealth() {
  if (IS_MOCK) {
    const mockApi = await loadSupportMockApi();
    return mockApi.fetchMockPlatformOperationalHealth();
  }
  return requestSupportJson<PlatformOperationalHealthResponse>("/api/platform-admin/support?type=health", {
    cache: "no-store",
  });
}

export async function fetchPlatformSupportThread(threadId: string) {
  if (IS_MOCK) {
    const mockApi = await loadSupportMockApi();
    return mockApi.fetchMockPlatformSupportThread(threadId);
  }
  return requestSupportJson<PlatformSupportThreadResponse>(`/api/platform-admin/support?type=thread&thread_id=${encodeURIComponent(threadId)}`, {
    cache: "no-store",
  });
}

export async function fetchPlatformSupportSession(sessionId: string) {
  if (IS_MOCK) {
    const mockApi = await loadSupportMockApi();
    return mockApi.fetchMockPlatformSupportSession(sessionId);
  }
  return requestSupportJson<PlatformSupportSessionResponse>(`/api/platform-admin/support?type=session&session_id=${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
  });
}

export async function sendPlatformSupportMessage(threadId: string, text: string) {
  if (IS_MOCK) {
    const mockApi = await loadSupportMockApi();
    return mockApi.sendMockPlatformSupportMessage(threadId, text);
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
    const mockApi = await loadSupportMockApi();
    return mockApi.markMockPlatformSupportThreadRead(threadId);
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
    const mockApi = await loadSupportMockApi();
    return mockApi.closeMockPlatformSupportThread(threadId);
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
