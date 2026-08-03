"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  closePlatformSupportThread,
  fetchPlatformSupportSession,
  fetchPlatformSupportThread,
  markPlatformSupportThreadRead,
  sendPlatformSupportMessage,
  type PlatformSupportSessionResponse,
  type SupportMessage,
  type SupportTranscriptEvent,
  type SupportThreadState,
} from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { SupportThreadChat } from "./SupportThreadChat";

const PLATFORM_SUPPORT_THREAD_POLL_MS = 30000;

function formatThreadUserLabel(
  thread: SupportThreadState | null,
  anonLabel: string,
) {
  if (!thread) return "";
  if (thread.user_name) return thread.user_name;
  if (thread.user_email) return thread.user_email;
  if (thread.user_id.startsWith("anon:")) {
    return `${anonLabel} #${thread.user_id.slice(5).slice(-6)}`;
  }
  return thread.user_id;
}

function readChoicePath(transcript: SupportTranscriptEvent[]): string {
  return transcript
    .filter((event) => event.event_type === "user_choice")
    .map((event) => (typeof event.payload.label === "string" ? event.payload.label.trim() : ""))
    .filter(Boolean)
    .join(" > ");
}

function readFirstUserText(transcript: SupportTranscriptEvent[]): string {
  return transcript
    .filter((event) => event.event_type === "user_text")
    .map((event) => (typeof event.payload.text === "string" ? event.payload.text.trim() : ""))
    .find(Boolean) || "";
}

function supportMessagesEqual(left: SupportMessage[], right: SupportMessage[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((message, index) => {
    const next = right[index];
    return !!next
      && message.id === next.id
      && message.text === next.text
      && message.sender_role === next.sender_role
      && message.created_at === next.created_at;
  });
}

export function PlatformSupportThreadPanel({ threadId }: { threadId: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const [threadDetail, setThreadDetail] = useState<SupportThreadState | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [sessionDetail, setSessionDetail] = useState<PlatformSupportSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const hasCompletedInitialLoadRef = useRef(false);
  const shouldFollowMessagesRef = useRef(true);
  const lastRenderedMessageIdRef = useRef<string | null>(null);
  const loadThreadInFlightRef = useRef<Promise<void> | null>(null);

  async function performLoadThread() {
    const threadResult = await fetchPlatformSupportThread(threadId);
    if (threadResult._status === 403) {
      setError(t("supportNoAccess"));
      setLoading(false);
      return;
    }
    if (threadResult._status >= 400 || !threadResult.thread) {
      setError(typeof threadResult.error === "string" ? threadResult.error : t("sendFailed"));
      setLoading(false);
      return;
    }

    const scrollElement = messagesRef.current;
    shouldFollowMessagesRef.current = !hasCompletedInitialLoadRef.current
      || !scrollElement
      || scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <= 96;

    setThreadDetail(threadResult.thread);
    const nextMessages = threadResult.messages || [];
    setMessages((current) => supportMessagesEqual(current, nextMessages) ? current : nextMessages);

    if (threadResult.thread.source_session_id) {
      const sessionResult = await fetchPlatformSupportSession(threadResult.thread.source_session_id);
      if (sessionResult._status < 400) {
        setSessionDetail({
          session: sessionResult.session ?? null,
          transcript: sessionResult.transcript || [],
          currentNode: sessionResult.currentNode ?? null,
        });
      } else {
        setSessionDetail(null);
      }
    } else {
      setSessionDetail(null);
    }

    setError("");
    setLoading(false);
    hasCompletedInitialLoadRef.current = true;
  }

  function loadThread(): Promise<void> {
    if (loadThreadInFlightRef.current) return loadThreadInFlightRef.current;
    const request = performLoadThread()
      .catch(() => {
        setError(t("sendFailed"));
        setLoading(false);
      })
      .finally(() => {
        if (loadThreadInFlightRef.current === request) {
          loadThreadInFlightRef.current = null;
        }
      });
    loadThreadInFlightRef.current = request;
    return request;
  }

  const loadThreadEffect = useEffectEvent(() => {
    void loadThread();
  });

  useEffect(() => {
    const refreshThread = () => {
      if (document.visibilityState !== "visible") return;
      loadThreadEffect();
    };
    const initialTimer = window.setTimeout(() => {
      refreshThread();
    }, 0);
    const timer = window.setInterval(() => {
      refreshThread();
    }, PLATFORM_SUPPORT_THREAD_POLL_MS);
    window.addEventListener("focus", refreshThread);
    document.addEventListener("visibilitychange", refreshThread);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshThread);
      document.removeEventListener("visibilitychange", refreshThread);
    };
  }, [threadId]);

  useEffect(() => {
    if (loading) return;
    const element = messagesRef.current;
    if (!element) return;
    const lastMessageId = messages.at(-1)?.id || null;
    const isInitialPosition = lastRenderedMessageIdRef.current === null;
    const hasNewLastMessage = lastMessageId !== lastRenderedMessageIdRef.current;
    lastRenderedMessageIdRef.current = lastMessageId;
    if (!isInitialPosition && (!hasNewLastMessage || !shouldFollowMessagesRef.current)) return;

    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, messages]);

  useEffect(() => {
    if (!threadDetail?.id || !threadDetail.unread_for_admin) return;
    void markPlatformSupportThreadRead(threadDetail.id).then((result) => {
      if (result._status >= 400) return;
      setThreadDetail((current) => (
        current?.id === threadDetail.id
          ? {
              ...current,
              unread_for_admin: false,
            }
          : current
      ));
      window.dispatchEvent(new CustomEvent("support-ticket-changed"));
    });
  }, [threadDetail?.id, threadDetail?.unread_for_admin]);

  async function handleSend() {
    if (submitting || !threadDetail || threadDetail.status !== "open" || !draft.trim()) return;
    setSubmitting(true);
    const result = await sendPlatformSupportMessage(threadDetail.id, draft.trim());
    if (result._status >= 400 || !result.message) {
      setError(typeof result.error === "string" ? result.error : t("sendFailed"));
    } else {
      setDraft("");
      await loadThread();
    }
    setSubmitting(false);
  }

  async function handleCloseThread() {
    if (submitting || !threadDetail || threadDetail.status !== "open") return;
    setSubmitting(true);
    const result = await closePlatformSupportThread(threadDetail.id);
    if (result._status >= 400) {
      setError(typeof result.error === "string" ? result.error : t("sendFailed"));
    } else {
      await loadThread();
    }
    setSubmitting(false);
  }

  const visibleMessages = threadDetail
    ? messages.filter((message, index) => !(
      index === 0
      && threadDetail.summary
      && message.sender_role === "user"
      && message.text === threadDetail.summary
    ))
    : [];
  const choicePath = readChoicePath(sessionDetail?.transcript || []);
  const firstUserText = readFirstUserText(sessionDetail?.transcript || []);
  const actorTypeLabel = threadDetail?.actor_type === "guest" ? t("supportActorGuest") : t("supportActorLoggedIn");
  const lastActionLabel = threadDetail
    ? (
      threadDetail.last_action === "ticket_created" ? t("supportLastActionCreated")
        : threadDetail.last_action === "user_replied" ? t("supportLastActionUserReplied")
          : threadDetail.last_action === "admin_replied" ? t("supportLastActionAdminReplied")
            : threadDetail.last_action === "user_closed" ? t("supportLastActionUserClosed")
              : t("supportLastActionAdminClosed")
    )
    : "";
  const openForLabel = threadDetail
    ? threadDetail.open_duration_minutes >= 1440
      ? t("supportOpenForDays").replace("{count}", String(Math.max(1, Math.floor(threadDetail.open_duration_minutes / 1440))))
      : threadDetail.open_duration_minutes >= 60
        ? t("supportOpenForHours").replace("{count}", String(Math.max(1, Math.floor(threadDetail.open_duration_minutes / 60))))
        : t("supportOpenForMinutes").replace("{count}", String(Math.max(1, threadDetail.open_duration_minutes)))
    : "";
  const headerRows = threadDetail ? [
    { label: t("supportIssueCategory"), value: threadDetail.entry_topic_label },
    ...(choicePath ? [{ label: t("supportChosenPath"), value: choicePath }] : []),
    { label: t("supportUserMessage"), value: firstUserText || threadDetail.summary },
    { label: t("supportActorType"), value: actorTypeLabel },
    { label: t("supportLastAction"), value: lastActionLabel },
    { label: t("supportOpenFor"), value: openForLabel },
  ] : [];

  return (
    <SupportThreadChat
      title={threadDetail?.entry_topic_label || t("supportMenu")}
      subtitle={formatThreadUserLabel(threadDetail, t("anon"))}
      headerRows={headerRows}
      transcript={sessionDetail?.transcript || []}
      messagesRef={messagesRef}
      messages={visibleMessages}
      loading={loading}
      error={!threadDetail ? (error || t("supportNoAccess")) : error}
      status={threadDetail?.status || "closed"}
      selfRole="platform_admin"
      draft={draft}
      onDraftChange={setDraft}
      onSend={() => { void handleSend(); }}
      onBack={() => router.push("/dashboard")}
      onCloseTicket={threadDetail?.status === "open" ? () => { void handleCloseThread(); } : undefined}
      submitting={submitting}
      placeholder={t("supportReplyPlaceholder")}
    />
  );
}
