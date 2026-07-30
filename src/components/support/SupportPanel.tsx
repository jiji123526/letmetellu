"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  answerSupportSession,
  clearSupportSession,
  escalateSupportSession,
  fetchSupportState,
  sendSupportThreadMessage,
  startSupportSession,
  type SupportStateResponse,
  type SupportTranscriptEvent,
} from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { SupportThreadChat } from "./SupportThreadChat";

const emptySupportState: SupportStateResponse = {
  thread: null,
  messages: [],
  session: null,
  transcript: [],
  currentNode: null,
};

function readTranscriptText(event: SupportTranscriptEvent): string {
  if (event.event_type === "user_choice") {
    return typeof event.payload.label === "string" ? event.payload.label : "";
  }
  if (event.event_type === "escalation") {
    return "";
  }
  return typeof event.payload.text === "string" ? event.payload.text : "";
}

export function SupportPanel() {
  const router = useRouter();
  const { t } = useLocale();
  const [supportState, setSupportState] = useState<SupportStateResponse>(emptySupportState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [threadDraft, setThreadDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);
  const openThreadId = supportState.thread?.id ?? null;

  function applyState(next: Partial<SupportStateResponse>) {
    setSupportState((current) => ({
      platformAdmin: current.platformAdmin ?? false,
      thread: next.thread ?? null,
      messages: next.messages ?? (next.thread ? [] : current.messages),
      session: next.session ?? null,
      transcript: next.transcript ?? (next.thread ? [] : current.transcript),
      currentNode: next.currentNode ?? null,
    }));
  }

  async function loadState(autoStartWhenEmpty: boolean) {
    const result = await fetchSupportState();
    if (closingRef.current) {
      setLoading(false);
      return;
    }
    if (result._status === 401) {
      setError(t("supportNoAccess"));
      setLoading(false);
      return;
    }
    if (result._status >= 400) {
      setError(typeof result.error === "string" ? result.error : t("sendFailed"));
      setLoading(false);
      return;
    }
    if (!result.thread && !result.session && autoStartWhenEmpty) {
      const started = await startSupportSession();
      if (closingRef.current) {
        if (started._status < 400 && started.session?.status === "open") {
          await clearSupportSession(started.session.id).catch(() => {});
        }
        setLoading(false);
        return;
      }
      if (started._status >= 400) {
        setError(typeof started.error === "string" ? started.error : t("sendFailed"));
        setLoading(false);
        return;
      }
      applyState(started);
      setLoading(false);
      return;
    }
    applyState(result);
    setLoading(false);
  }

  const loadStateEffect = useEffectEvent((autoStartWhenEmpty: boolean) => {
    void loadState(autoStartWhenEmpty);
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadStateEffect(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    closingRef.current = true;
  }, []);

  useEffect(() => {
    if (!openThreadId) return;
    const timer = window.setInterval(() => {
      loadStateEffect(false);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [openThreadId]);

  useEffect(() => {
    const element = transcriptRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [supportState.transcript, supportState.messages, supportState.currentNode?.id, supportState.thread?.updated_at]);

  async function handleStart() {
    if (submitting) return;
    setSubmitting(true);
    const result = await startSupportSession();
    if (result._status >= 400) {
      setError(typeof result.error === "string" ? result.error : t("sendFailed"));
    } else {
      applyState(result);
      setError("");
    }
    setSubmitting(false);
  }

  async function handleChoice(choiceId: string) {
    if (submitting || !supportState.session) return;
    setSubmitting(true);
    const result = await answerSupportSession({
      session_id: supportState.session.id,
      choice_id: choiceId,
    });
    if (result._status >= 400) {
      setError(typeof result.error === "string" ? result.error : t("sendFailed"));
    } else {
      applyState(result);
      setTextDraft("");
      setError("");
    }
    setSubmitting(false);
  }

  async function handleTextSubmit() {
    if (submitting || !supportState.session || !textDraft.trim()) return;
    setSubmitting(true);
    const result = await answerSupportSession({
      session_id: supportState.session.id,
      text: textDraft.trim(),
    });
    if (result._status >= 400) {
      setError(typeof result.error === "string" ? result.error : t("sendFailed"));
    } else {
      applyState(result);
      setTextDraft("");
      setError("");
    }
    setSubmitting(false);
  }

  async function handleEscalate() {
    if (submitting || !supportState.session) return;
    setSubmitting(true);
    const result = await escalateSupportSession(supportState.session.id);
    if (result._status >= 400) {
      setError(typeof result.error === "string" ? result.error : t("sendFailed"));
    } else {
      applyState({
        thread: "thread" in result ? result.thread ?? null : null,
        messages: "messages" in result ? result.messages ?? [] : [],
        session: null,
        transcript: [],
        currentNode: null,
      });
      setError("");
    }
    setSubmitting(false);
  }

  async function handleThreadSend() {
    if (submitting || !supportState.thread || !threadDraft.trim()) return;
    setSubmitting(true);
    const result = await sendSupportThreadMessage(supportState.thread.id, threadDraft.trim());
    if (result._status >= 400 || !result.message) {
      setError(typeof result.error === "string" ? result.error : t("sendFailed"));
    } else {
      const message = result.message;
      setSupportState((current) => ({
        ...current,
        messages: [...current.messages, message],
        thread: current.thread ? {
          ...current.thread,
          updated_at: message.created_at,
          last_message: message.text,
        } : null,
      }));
      setThreadDraft("");
      setError("");
    }
    setSubmitting(false);
  }

  async function handleClosePanel() {
    if (closing) return;
    closingRef.current = true;
    setClosing(true);
    try {
      if (supportState.session?.status === "open") {
        await clearSupportSession(supportState.session.id);
      }
    } finally {
      router.push("/dashboard");
    }
  }

  if (supportState.thread) {
    return (
      <SupportThreadChat
        title={t("supportMenu")}
        subtitle=""
        topicLabel={supportState.thread.entry_topic_label}
        messagesRef={transcriptRef}
        messages={supportState.messages}
        loading={loading}
        error={error}
        status={supportState.thread.status}
        selfRole="user"
        draft={threadDraft}
        onDraftChange={setThreadDraft}
        onSend={() => { void handleThreadSend(); }}
        onBack={() => router.push("/dashboard")}
        submitting={submitting}
        placeholder={t("supportReplyPlaceholder")}
      />
    );
  }

  return (
    <main className="min-h-dvh px-4 py-6" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      <div className="mx-auto flex min-h-[calc(100dvh-48px)] max-w-[760px] flex-col overflow-hidden rounded-[28px] border" style={{ background: "var(--input-bg)", borderColor: "var(--hairline)", boxShadow: "0 24px 70px rgba(15,23,42,.08)" }}>
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--hairline)" }}>
          <div>
            <div className="text-[12px] font-medium uppercase tracking-[0.18em]" style={{ color: "var(--meta)" }}>{t("supportTitle")}</div>
            <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.03em]">{t("supportTitle")}</h1>
            <p className="mt-2 max-w-[520px] text-[13px] leading-[1.6]" style={{ color: "var(--secondary-text)" }}>{t("supportSubtitle")}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={closing}
              className="rounded-full border px-3 py-2 text-[12px] font-semibold"
              style={{ borderColor: "var(--hairline)", color: "var(--gray-text)" }}
              onClick={() => void handleClosePanel()}
              aria-label={t("close")}
            >
              ✕
            </button>
          </div>
        </header>

        <section ref={transcriptRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="rounded-[20px] px-4 py-5 text-[14px]" style={{ background: "var(--card)", color: "var(--meta)" }}>
              {t("loading")}
            </div>
          ) : (
            <>
              {supportState.transcript.map((event) => {
                if (event.event_type === "escalation") {
                  return (
                    <div key={event.id} className="flex justify-start">
                      <div className="rounded-[20px] px-4 py-3 text-[13px] font-medium" style={{ background: "#eef2ff", color: "#312e81" }}>
                        {t("supportEscalated")}
                      </div>
                    </div>
                  );
                }
                const text = readTranscriptText(event);
                if (!text) return null;
                const isBot = event.event_type === "bot_message";
                return (
                  <div key={event.id} className={`flex ${isBot ? "justify-start" : "justify-end"}`}>
                    <div
                      className="max-w-[88%] rounded-[22px] px-4 py-3"
                      style={{
                        background: isBot ? "var(--card)" : "#111827",
                        color: isBot ? "var(--gray-text)" : "#fff",
                      }}
                    >
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: isBot ? "var(--meta)" : "rgba(255,255,255,.68)" }}>
                        {isBot ? t("supportBot") : t("supportUser")}
                      </div>
                      <div className="whitespace-pre-wrap text-[14px] leading-[1.6]">{text}</div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {!loading && error && (
            <div className="rounded-[18px] border px-4 py-3 text-[13px]" style={{ borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c" }}>
              {error}
            </div>
          )}
        </section>

        <footer className="border-t px-4 py-4" style={{ borderColor: "var(--hairline)", background: "rgba(255,255,255,.8)" }}>
          {supportState.currentNode?.kind === "choice" ? (
            <div className="flex flex-wrap gap-2">
              {supportState.currentNode.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => void handleChoice(choice.id)}
                  disabled={submitting}
                  className="rounded-full border px-4 py-2 text-[13px] font-medium"
                  style={{ borderColor: "var(--hairline)", background: "var(--bg)" }}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          ) : supportState.currentNode?.kind === "text" ? (
            <div className="space-y-3">
              <textarea
                value={textDraft}
                onChange={(event) => setTextDraft(event.target.value)}
                rows={3}
                className="w-full resize-none rounded-[18px] border px-4 py-3 text-[14px] outline-none"
                style={{ borderColor: "var(--hairline)", background: "var(--bg)" }}
                placeholder={supportState.currentNode.placeholder}
                disabled={submitting}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleTextSubmit()}
                  disabled={submitting || !textDraft.trim()}
                  className="rounded-[18px] px-4 py-3 text-[14px] font-semibold text-white"
                  style={{ background: submitting || !textDraft.trim() ? "#9ca3af" : "#111827" }}
                >
                  {supportState.currentNode.submitLabel || t("send")}
                </button>
              </div>
            </div>
          ) : supportState.currentNode?.kind === "escalate" ? (
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px] leading-[1.5]" style={{ color: "var(--secondary-text)" }}>
                {supportState.currentNode.messages[0]}
              </div>
              <button
                type="button"
                onClick={() => void handleEscalate()}
                disabled={submitting}
                className="rounded-[18px] px-4 py-3 text-[14px] font-semibold text-white"
                style={{ background: submitting ? "#9ca3af" : "#111827" }}
              >
                {supportState.currentNode.escalationLabel || t("supportStart")}
              </button>
            </div>
          ) : supportState.currentNode?.kind === "terminal" ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleStart()}
                disabled={submitting}
                className="rounded-[18px] px-4 py-3 text-[14px] font-semibold text-white"
                style={{ background: submitting ? "#9ca3af" : "#111827" }}
              >
                {t("supportRestart")}
              </button>
            </div>
          ) : (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleStart()}
                disabled={submitting}
                className="rounded-[18px] px-4 py-3 text-[14px] font-semibold text-white"
                style={{ background: submitting ? "#9ca3af" : "#111827" }}
              >
                {t("supportStart")}
              </button>
            </div>
          )}
        </footer>
      </div>
    </main>
  );
}
