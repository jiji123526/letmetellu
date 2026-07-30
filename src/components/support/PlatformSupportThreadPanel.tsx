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

function formatSupportTimestamp(value: string, locale: "ko" | "en", timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

function readTranscriptText(
  event: PlatformSupportSessionResponse["transcript"][number],
  escalatedLabel: string,
) {
  if (event.event_type === "escalation") return escalatedLabel;
  if (event.event_type === "user_choice") {
    return typeof event.payload.label === "string" ? event.payload.label : "";
  }
  return typeof event.payload.text === "string" ? event.payload.text : "";
}

export function PlatformSupportThreadPanel({ threadId }: { threadId: string }) {
  const router = useRouter();
  const { locale, timeZone, t } = useLocale();
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
    <main className="min-h-dvh px-4 py-6" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      <div className="mx-auto flex min-h-[calc(100dvh-48px)] max-w-[1200px] flex-col overflow-hidden rounded-[28px] border lg:grid lg:grid-cols-[1.2fr,360px]" style={{ background: "var(--input-bg)", borderColor: "var(--hairline)", boxShadow: "0 24px 70px rgba(15,23,42,.08)" }}>
        <section className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r" style={{ borderColor: "var(--hairline)" }}>
          <header className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--hairline)" }}>
            <div>
              <div className="text-[12px] font-medium uppercase tracking-[0.18em]" style={{ color: "var(--meta)" }}>{t("dashboardTicketsSection")}</div>
              <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.03em]">
                {threadDetail ? threadDetail.entry_topic_label : t("supportMenu")}
              </h1>
              <p className="mt-1 text-[13px]" style={{ color: "var(--secondary-text)" }}>
                {threadDetail ? (threadDetail.user_name || threadDetail.user_email || threadDetail.user_id) : error || t("loading")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {threadDetail?.status === "closed" && (
                <span className="rounded-full px-3 py-2 text-[11px] font-semibold" style={{ background: "var(--card)", color: "var(--meta)" }}>
                  {t("dashboardTicketClosed")}
                </span>
              )}
              {threadDetail?.status === "open" && (
                <button
                  type="button"
                  onClick={() => void handleCloseThread()}
                  disabled={submitting}
                  className="rounded-full px-4 py-2 text-[12px] font-semibold text-white"
                  style={{ background: submitting ? "#9ca3af" : "#111827" }}
                >
                  {t("supportCloseTicket")}
                </button>
              )}
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="rounded-full border px-3 py-2 text-[12px] font-semibold"
                style={{ borderColor: "var(--hairline)", color: "var(--gray-text)" }}
              >
                {t("dashboardBack")}
              </button>
            </div>
          </header>

          <div ref={messagesRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {loading ? (
              <div className="rounded-[20px] px-4 py-5 text-[14px]" style={{ background: "var(--card)", color: "var(--meta)" }}>
                {t("loading")}
              </div>
            ) : !threadDetail ? (
              <div className="rounded-[20px] px-4 py-5 text-[14px]" style={{ background: "var(--card)", color: "var(--meta)" }}>
                {error || t("supportNoAccess")}
              </div>
            ) : (
              messages.map((message) => {
                const isAdmin = message.sender_role === "platform_admin";
                return (
                  <div key={message.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                    <div
                      className="max-w-[88%] rounded-[22px] px-4 py-3"
                      style={{
                        background: isAdmin ? "#111827" : "var(--card)",
                        color: isAdmin ? "#fff" : "var(--gray-text)",
                      }}
                    >
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: isAdmin ? "rgba(255,255,255,.68)" : "var(--meta)" }}>
                        {isAdmin ? t("supportAdmin") : t("supportUser")}
                      </div>
                      <div className="whitespace-pre-wrap text-[14px] leading-[1.6]">{message.text}</div>
                      <div className="mt-2 text-[11px]" style={{ color: isAdmin ? "rgba(255,255,255,.68)" : "var(--meta)" }}>
                        {formatSupportTimestamp(message.created_at, locale, timeZone)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {threadDetail?.status === "open" && (
            <footer className="border-t px-4 py-4" style={{ borderColor: "var(--hairline)" }}>
              <div className="flex gap-3">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={2}
                  placeholder={t("supportReplyPlaceholder")}
                  className="min-h-[82px] flex-1 resize-none rounded-[20px] border px-4 py-3 text-[14px] outline-none"
                  style={{ borderColor: "var(--hairline)", background: "var(--bg)" }}
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={submitting || !draft.trim()}
                  className="self-end rounded-full px-4 py-2 text-[12px] font-semibold text-white"
                  style={{ background: submitting || !draft.trim() ? "#9ca3af" : "#111827" }}
                >
                  {t("send")}
                </button>
              </div>
            </footer>
          )}
        </section>

        <aside className="min-h-0 px-4 py-4">
          <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: "var(--hairline)", background: "var(--bg)" }}>
            <div className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--meta)" }}>
              {t("supportSummary")}
            </div>
            <div className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.6]">
              {threadDetail?.summary || "—"}
            </div>
          </div>

          {sessionDetail && (
            <div className="mt-4 rounded-[20px] border px-4 py-4" style={{ borderColor: "var(--hairline)", background: "var(--bg)" }}>
              <div className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--meta)" }}>
                {t("supportTranscript")}
              </div>
              <div className="mt-3 space-y-3">
                {sessionDetail.transcript.map((event) => {
                  const isBot = event.event_type === "bot_message";
                  const text = readTranscriptText(event, t("supportEscalated"));
                  if (!text) return null;
                  return (
                    <div key={event.id}>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--meta)" }}>
                        {isBot ? t("supportBot") : event.event_type === "escalation" ? t("supportAdmin") : t("supportUser")}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-[13px] leading-[1.55]">{text}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
