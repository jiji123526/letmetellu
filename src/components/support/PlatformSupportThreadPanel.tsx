"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  closePlatformSupportThread,
  fetchPlatformSupportSession,
  fetchPlatformSupportThread,
  sendPlatformSupportMessage,
  type PlatformSupportSessionResponse,
  type SupportMessage,
  type SupportThreadState,
} from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { SupportThreadChat } from "./SupportThreadChat";

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

  async function loadThread() {
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

    setThreadDetail(threadResult.thread);
    setMessages(threadResult.messages || []);

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
  }

  const loadThreadEffect = useEffectEvent(() => {
    void loadThread();
  });

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      loadThreadEffect();
    }, 0);
    const timer = window.setInterval(() => {
      loadThreadEffect();
    }, 5000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [threadId]);

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, sessionDetail?.transcript.length, threadDetail?.updated_at]);

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

  return (
    <SupportThreadChat
      title={threadDetail?.entry_topic_label || t("supportMenu")}
      subtitle={threadDetail ? (threadDetail.user_name || threadDetail.user_email || threadDetail.user_id) : ""}
      summary={threadDetail?.summary || ""}
      transcript={sessionDetail?.transcript || []}
      messagesRef={messagesRef}
      messages={threadDetail ? messages : []}
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
