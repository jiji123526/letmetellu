"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  answerSupportSession,
  clearStoredSupportTicketPreview,
  clearSupportSession,
  fetchSupportState,
  sendSupportThreadMessage,
  startSupportSession,
  storeSupportTicketPreview,
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

export function SupportPanel({ showThreadView = false }: { showThreadView?: boolean }) {
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
  const hasActiveTicket = !!supportState.thread;
  const hasGuidedSession = !!supportState.session;

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
    if (result.thread) {
      const latestMessage = result.messages?.[result.messages.length - 1] || null;
      storeSupportTicketPreview({
        threadId: result.thread.id,
        topicLabel: result.thread.entry_topic_label,
        preview: result.thread.last_message || latestMessage?.text || result.thread.summary,
        updatedAt: result.thread.updated_at,
      });
    } else if (!result.session) {
      clearStoredSupportTicketPreview();
    }
    if (!result.session && autoStartWhenEmpty && !showThreadView) {
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
    }, 1000);
    return () => window.clearInterval(timer);
  }, [openThreadId]);

  useEffect(() => {
    if (!showThreadView || loading) return;
    if (supportState.thread) return;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("support-ticket-changed"));
    }
    router.push("/dashboard");
  }, [showThreadView, loading, supportState.thread, router]);

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
      if ("thread" in result && result.thread) {
        const latestMessage = result.messages?.[result.messages.length - 1] || null;
        storeSupportTicketPreview({
          threadId: result.thread.id,
          topicLabel: result.thread.entry_topic_label,
          preview: result.thread.last_message || latestMessage?.text || result.thread.summary,
          updatedAt: result.thread.updated_at,
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("support-ticket-changed"));
        }
        setSubmitting(false);
        router.push("/dashboard");
        return;
      }
      applyState(result);
      setTextDraft("");
      setError("");
    }
    setSubmitting(false);
  }

  async function handleThreadSend() {
    if (submitting || !supportState.thread || !threadDraft.trim()) return;
    setSubmitting(true);
    const result = await sendSupportThreadMessage(supportState.thread.id, threadDraft.trim());
    if (result._status >= 400 || !result.message) {
      setError(
        result.error === "await_admin_reply"
          ? t("supportWaitingForAdmin")
          : typeof result.error === "string"
            ? result.error
            : t("sendFailed")
      );
    } else {
      const message = result.message;
      const updatedThread = supportState.thread ? {
        ...supportState.thread,
        updated_at: message.created_at,
        last_message: message.text,
        can_user_send: false,
      } : null;
      setSupportState((current) => ({
        ...current,
        messages: [...current.messages, message],
        thread: updatedThread,
      }));
      if (updatedThread) {
        storeSupportTicketPreview({
          threadId: updatedThread.id,
          topicLabel: updatedThread.entry_topic_label,
          preview: message.text,
          updatedAt: message.created_at,
        });
      }
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

  if (showThreadView && supportState.thread) {
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
        placeholder={supportState.thread.can_user_send ? t("supportReplyPlaceholder") : t("supportWaitingForAdminPlaceholder")}
        canSend={supportState.thread.can_user_send}
      />
    );
  }

  return (
    <div className="h-dvh max-w-[480px] mx-auto flex flex-col relative md:border-x" style={{ background: "var(--bg)", color: "var(--gray-text)", borderColor: "var(--hairline)" }}>
      <header
        className="flex-none flex items-center px-4 relative"
        style={{
          background: "var(--header-bg)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderBottom: "0.5px solid var(--hairline)",
          padding: "10px 16px",
          zIndex: 5,
        }}
      >
        <button
          type="button"
          className="absolute left-4 top-1/2 -translate-y-1/2 p-0 border-none bg-transparent cursor-pointer flex items-center"
          style={{ color: "var(--bubble-sent, #3b8df0)" }}
          onClick={() => void handleClosePanel()}
          aria-label={t("dashboardBack")}
          disabled={closing}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 3px)", height: "calc(var(--bubble-font-size) + 3px)" }}>
            <path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex-1 min-w-0 flex flex-col items-center px-12">
          <div className="max-w-full truncate font-semibold" style={{ fontSize: "var(--bubble-font-size)" }}>
            {t("supportTitle")}
          </div>
          <div className="max-w-full truncate" style={{ fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--meta)" }}>
            {!hasGuidedSession && hasActiveTicket ? t("supportTicketOpen") : t("supportSubtitle")}
          </div>
        </div>
      </header>

      <div className="relative flex-1 min-h-0 overflow-hidden" style={{ background: "var(--bg)" }}>
        <main
          ref={transcriptRef}
          className="messages-scroll relative z-[1] h-full overflow-y-auto overflow-x-hidden flex flex-col"
          style={{ padding: "12px 14px 8px", WebkitOverflowScrolling: "touch", background: "transparent" }}
        >
          {loading && !supportState.session && !supportState.thread ? (
            <div className="flex items-end gap-[6px] max-w-full justify-start" style={{ paddingTop: "calc(var(--bubble-font-size) * 0.18)" }}>
              <div className="flex flex-col items-start" style={{ maxWidth: "74%" }}>
                <div
                  data-bubble
                  className="relative max-w-full break-words whitespace-pre-wrap select-none"
                  style={{
                    padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)",
                    fontSize: "var(--bubble-font-size)",
                    lineHeight: 1.38,
                    overflowWrap: "anywhere",
                    borderRadius: "20px 20px 20px 4px",
                    background: "var(--gray-bubble)",
                    color: "var(--gray-text)",
                  }}
                >
                  {t("loading")}
                </div>
              </div>
            </div>
          ) : !hasActiveTicket && !supportState.session && supportState.transcript.length === 0 ? (
            <div className="flex items-end gap-[6px] max-w-full justify-start" style={{ paddingTop: "calc(var(--bubble-font-size) * 0.18)" }}>
              <div className="flex flex-col items-start" style={{ maxWidth: "74%" }}>
                <div
                  data-bubble
                  className="relative max-w-full break-words whitespace-pre-wrap select-none"
                  style={{
                    padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)",
                    fontSize: "var(--bubble-font-size)",
                    lineHeight: 1.38,
                    overflowWrap: "anywhere",
                    borderRadius: "20px 20px 20px 4px",
                    background: "var(--gray-bubble)",
                    color: "var(--gray-text)",
                  }}
                >
                  {t("supportSubtitle")}
                </div>
              </div>
            </div>
          ) : hasActiveTicket && !hasGuidedSession ? (
            <>
              <div className="flex items-end gap-[6px] max-w-full justify-start" style={{ paddingTop: "calc(var(--bubble-font-size) * 0.18)" }}>
                <div className="flex flex-col items-start" style={{ maxWidth: "74%" }}>
                  <div
                    data-bubble
                    className="relative max-w-full break-words whitespace-pre-wrap select-none"
                    style={{
                      padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)",
                      fontSize: "var(--bubble-font-size)",
                      lineHeight: 1.38,
                      overflowWrap: "anywhere",
                      borderRadius: "20px 20px 20px 4px",
                      background: "var(--gray-bubble)",
                      color: "var(--gray-text)",
                    }}
                  >
                    {t("supportActiveTicketNote")}
                  </div>
                </div>
              </div>
              {!supportState.thread?.can_user_send && (
                <div className="flex items-end gap-[6px] max-w-full justify-start" style={{ paddingTop: "calc(var(--bubble-font-size) * 0.18)" }}>
                  <div className="flex flex-col items-start" style={{ maxWidth: "74%" }}>
                    <div
                      data-bubble
                      className="relative max-w-full break-words whitespace-pre-wrap select-none"
                      style={{
                        padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)",
                        fontSize: "var(--bubble-font-size)",
                        lineHeight: 1.38,
                        overflowWrap: "anywhere",
                        borderRadius: "20px 20px 20px 4px",
                        background: "var(--gray-bubble)",
                        color: "var(--gray-text)",
                      }}
                    >
                      {t("supportWaitingForAdmin")}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {hasGuidedSession && hasActiveTicket && (
                <div className="flex items-end gap-[6px] max-w-full justify-start" style={{ paddingTop: "calc(var(--bubble-font-size) * 0.18)" }}>
                  <div className="flex flex-col items-start" style={{ maxWidth: "74%" }}>
                    <div
                      data-bubble
                      className="relative max-w-full break-words whitespace-pre-wrap select-none"
                      style={{
                        padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)",
                        fontSize: "var(--bubble-font-size)",
                        lineHeight: 1.38,
                        overflowWrap: "anywhere",
                        borderRadius: "20px 20px 20px 4px",
                        background: "var(--gray-bubble)",
                        color: "var(--gray-text)",
                      }}
                    >
                      {t("supportActiveTicketNote")}
                    </div>
                  </div>
                </div>
              )}
              {supportState.transcript.map((event) => {
                if (event.event_type === "escalation") return null;
                const text = readTranscriptText(event);
                if (!text) return null;
                const isBot = event.event_type === "bot_message";
                return (
                  <div
                    key={event.id}
                    className={`flex items-end gap-[6px] max-w-full ${isBot ? "justify-start" : "justify-end"}`}
                    style={{ paddingTop: "calc(var(--bubble-font-size) * 0.18)" }}
                  >
                    <div className={`flex flex-col ${isBot ? "items-start" : "items-end"}`} style={{ maxWidth: "74%" }}>
                      <div
                        data-bubble
                        className="relative max-w-full break-words whitespace-pre-wrap select-none"
                        style={{
                          padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)",
                          fontSize: "var(--bubble-font-size)",
                          lineHeight: 1.38,
                          overflowWrap: "anywhere",
                          borderRadius: isBot ? "20px 20px 20px 4px" : "20px 20px 4px 20px",
                          background: isBot ? "var(--gray-bubble)" : "var(--bubble-sent, #3b8df0)",
                          color: isBot ? "var(--gray-text)" : "#fff",
                        }}
                      >
                        {text}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {!loading && error && (
            <div className="flex items-end gap-[6px] max-w-full justify-start" style={{ paddingTop: "calc(var(--bubble-font-size) * 0.18)" }}>
              <div className="flex flex-col items-start" style={{ maxWidth: "74%" }}>
                <div
                  data-bubble
                  className="relative max-w-full break-words whitespace-pre-wrap select-none"
                  style={{
                    padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)",
                    fontSize: "var(--bubble-font-size)",
                    lineHeight: 1.38,
                    overflowWrap: "anywhere",
                    borderRadius: "20px 20px 20px 4px",
                    background: "#fff1f2",
                    color: "#b91c1c",
                  }}
                >
                  {error}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <footer
        className="flex-none"
        style={{
          padding: "8px 10px calc(8px + env(safe-area-inset-bottom))",
          background: "var(--composer-bg)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderTop: "0.5px solid var(--hairline)",
        }}
      >
        {hasActiveTicket && (
          <div className={`flex items-end gap-2 ${hasGuidedSession ? "mb-2" : ""}`}>
            <button
              type="button"
              onClick={() => router.push(`/support?thread=${encodeURIComponent(supportState.thread?.id || "")}`)}
              className="ml-auto rounded-full border-none px-4 py-2 text-[13px] font-semibold text-white"
              style={{ background: "var(--bubble-sent, #3b8df0)" }}
            >
              {t("supportTicketOpen")}
            </button>
          </div>
        )}
        {hasActiveTicket && !hasGuidedSession ? null : supportState.currentNode?.kind === "choice" ? (
          <div className="flex flex-wrap gap-2">
            {supportState.currentNode.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                onClick={() => void handleChoice(choice.id)}
                disabled={submitting}
                className="rounded-full border px-4 py-2 text-[13px] font-medium"
                style={{ borderColor: "var(--hairline)", background: "var(--bg)", color: "var(--gray-text)" }}
              >
                {choice.label}
              </button>
            ))}
          </div>
        ) : supportState.currentNode?.kind === "text" ? (
          <div className="flex items-end gap-2">
            <div
              className="flex-1 flex items-center relative"
              style={{
                minHeight: "calc(var(--bubble-font-size) + 19px)",
                padding: "0 6px 0 calc(var(--bubble-font-size) * 0.824)",
                background: "var(--input-bg)",
                border: "1px solid var(--input-border)",
                borderRadius: "20px",
              }}
            >
              <textarea
                value={textDraft}
                onChange={(event) => setTextDraft(event.target.value)}
                rows={1}
                placeholder={supportState.currentNode.placeholder}
                disabled={submitting}
                className="flex-1 border-none bg-transparent outline-none resize-none"
                style={{
                  fontSize: "var(--bubble-font-size)",
                  color: "var(--gray-text)",
                  padding: "8px 0",
                  caretColor: "var(--tint)",
                  fontFamily: "inherit",
                  lineHeight: 1.4,
                  maxHeight: "80px",
                  overflowY: "auto",
                }}
              />
              {textDraft.trim() && (
                <button
                  type="button"
                  onClick={() => void handleTextSubmit()}
                  disabled={submitting}
                  className="flex-none flex items-center justify-center border-none cursor-pointer"
                  style={{
                    width: "calc(var(--bubble-font-size) + 9px)",
                    height: "calc(var(--bubble-font-size) + 9px)",
                    borderRadius: "50%",
                    background: submitting ? "#9ca3af" : "var(--bubble-sent, #3b8df0)",
                  }}
                >
                  <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) - 1px)", height: "calc(var(--bubble-font-size) - 1px)" }}>
                    <path d="M12 20V5m0 0l-6 6m6-6l6 6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ) : supportState.currentNode?.kind === "terminal" ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={submitting}
              className="rounded-full border-none px-4 py-2 text-[13px] font-semibold text-white"
              style={{ background: submitting ? "#9ca3af" : "var(--bubble-sent, #3b8df0)" }}
            >
              {t("supportRestart")}
            </button>
          </div>
        ) : null}
      </footer>
    </div>
  );
}
