"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { SupportMessage, SupportTranscriptEvent } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";

function readTranscriptText(event: SupportTranscriptEvent, escalatedLabel: string) {
  if (event.event_type === "escalation") return escalatedLabel;
  if (event.event_type === "user_choice") {
    return typeof event.payload.label === "string" ? event.payload.label : "";
  }
  return typeof event.payload.text === "string" ? event.payload.text : "";
}

interface SupportThreadChatProps {
  title: string;
  subtitle?: string;
  headerRows?: Array<{
    label: string;
    value: string;
  }>;
  topicLabel?: string;
  summary?: string;
  transcript?: SupportTranscriptEvent[];
  messagesRef: RefObject<HTMLDivElement | null>;
  messages: SupportMessage[];
  loading: boolean;
  error: string;
  status: "open" | "closed";
  selfRole: "user" | "platform_admin";
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onBack: () => void;
  onCloseTicket?: () => void;
  onAcknowledgeClosure?: () => void;
  menuActions?: Array<{
    label: string;
    onClick: () => void;
  }>;
  submitting: boolean;
  placeholder: string;
  canSend?: boolean;
}

export function SupportThreadChat({
  title,
  subtitle = "",
  headerRows = [],
  topicLabel = "",
  summary = "",
  transcript = [],
  messagesRef,
  messages,
  loading,
  error,
  status,
  selfRole,
  draft,
  onDraftChange,
  onSend,
  onBack,
  onCloseTicket,
  onAcknowledgeClosure,
  menuActions = [],
  submitting,
  placeholder,
  canSend = true,
}: SupportThreadChatProps) {
  const { t } = useLocale();
  const selfBubbleColor = selfRole === "platform_admin" ? "#202251" : "var(--bubble-sent, #3b8df0)";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

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
          style={{ color: selfBubbleColor }}
          onClick={onBack}
          aria-label={t("dashboardBack")}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 3px)", height: "calc(var(--bubble-font-size) + 3px)" }}>
            <path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex-1 min-w-0 flex flex-col items-center px-12">
          <div className="max-w-full truncate font-semibold" style={{ fontSize: "var(--bubble-font-size)" }}>
            {title}
          </div>
          {(subtitle || topicLabel) && (
            <div className="max-w-full truncate" style={{ fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--meta)" }}>
              {subtitle || topicLabel}
            </div>
          )}
        </div>

        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {status === "closed" && (
            <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ background: "var(--card)", color: "var(--meta)" }}>
              {t("dashboardTicketClosed")}
            </span>
          )}
          {status === "open" && onCloseTicket && (
            <button
              type="button"
              className="border-none rounded-full cursor-pointer"
              style={{
                background: selfBubbleColor,
                color: "#fff",
                padding: "8px 12px",
                fontSize: "calc(var(--bubble-font-size) - 5px)",
                fontFamily: "inherit",
                fontWeight: 600,
                lineHeight: 1,
              }}
              disabled={submitting}
              onClick={onCloseTicket}
            >
              {t("supportCloseTicket")}
            </button>
          )}
        </div>
      </header>

      <div className="relative flex-1 min-h-0 overflow-hidden" style={{ background: "var(--bg)" }}>
        <main
          ref={messagesRef}
          className="messages-scroll relative z-[1] h-full overflow-y-auto overflow-x-hidden flex flex-col"
          style={{ padding: "12px 14px 8px", WebkitOverflowScrolling: "touch", background: "transparent" }}
        >
          {topicLabel && (
            <div className="mb-3 flex justify-start">
              <div
                className="max-w-[88%] rounded-[18px]"
                style={{
                  padding: "calc(var(--bubble-font-size) * 0.52) calc(var(--bubble-font-size) * 0.74)",
                  background: "var(--card)",
                  color: "var(--gray-text)",
                }}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--meta)" }}>
                  {t("supportTicketOpen")}
                </div>
                <div className="mt-1 whitespace-pre-wrap" style={{ fontSize: "var(--bubble-font-size)", lineHeight: 1.5 }}>
                  {topicLabel}
                </div>
              </div>
            </div>
          )}

          {headerRows.length > 0 && (
            <div className="mb-3 flex justify-start">
              <div
                className="max-w-[88%] rounded-[18px]"
                style={{
                  padding: "calc(var(--bubble-font-size) * 0.52) calc(var(--bubble-font-size) * 0.74)",
                  background: "var(--card)",
                  color: "var(--gray-text)",
                }}
              >
                <div className="grid gap-3">
                  {headerRows.map((row) => (
                    <div key={row.label}>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--meta)" }}>
                        {row.label}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap break-words" style={{ fontSize: "calc(var(--bubble-font-size) - 2px)", lineHeight: 1.5 }}>
                        {row.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {summary && (
            <div className="mb-3 flex justify-start">
              <div
                className="max-w-[88%] rounded-[18px]"
                style={{
                  padding: "calc(var(--bubble-font-size) * 0.52) calc(var(--bubble-font-size) * 0.74)",
                  background: "var(--card)",
                  color: "var(--gray-text)",
                }}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--meta)" }}>
                  {t("supportSummary")}
                </div>
                <div className="mt-1 whitespace-pre-wrap" style={{ fontSize: "calc(var(--bubble-font-size) - 1px)", lineHeight: 1.55 }}>
                  {summary}
                </div>
              </div>
            </div>
          )}

          {transcript.length > 0 && (
            <div className="mb-3 flex justify-start">
              <details
                className="max-w-[88%] rounded-[18px]"
                style={{
                  padding: "calc(var(--bubble-font-size) * 0.52) calc(var(--bubble-font-size) * 0.74)",
                  background: "var(--card)",
                  color: "var(--gray-text)",
                }}
              >
                <summary className="cursor-pointer list-none font-semibold" style={{ fontSize: "calc(var(--bubble-font-size) - 2px)" }}>
                  {t("supportTranscript")}
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  {transcript.map((event) => {
                    const text = readTranscriptText(event, t("supportEscalated"));
                    if (!text) return null;
                    const roleLabel =
                      event.event_type === "bot_message"
                        ? t("supportBot")
                        : event.event_type === "escalation"
                          ? t("supportAdmin")
                          : t("supportUser");
                    return (
                      <div key={event.id}>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--meta)" }}>
                          {roleLabel}
                        </div>
                        <div className="mt-1 whitespace-pre-wrap" style={{ fontSize: "calc(var(--bubble-font-size) - 3px)", lineHeight: 1.5 }}>
                          {text}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            </div>
          )}

          {loading ? (
            <div className="flex justify-start">
              <div
                className="max-w-[88%] rounded-[18px]"
                style={{
                  padding: "calc(var(--bubble-font-size) * 0.52) calc(var(--bubble-font-size) * 0.74)",
                  background: "var(--card)",
                  color: "var(--meta)",
                  fontSize: "calc(var(--bubble-font-size) - 2px)",
                }}
              >
                {t("loading")}
              </div>
            </div>
          ) : messages.length === 0 && !error ? (
            <div className="flex justify-start">
              <div
                className="max-w-[88%] rounded-[18px]"
                style={{
                  padding: "calc(var(--bubble-font-size) * 0.52) calc(var(--bubble-font-size) * 0.74)",
                  background: "var(--card)",
                  color: "var(--meta)",
                  fontSize: "calc(var(--bubble-font-size) - 2px)",
                }}
              >
                {t("supportSelectThread")}
              </div>
            </div>
          ) : null}

          {messages.map((message, index) => {
            const isSelf = message.sender_role === selfRole;
            return (
              <div
                key={message.id}
                className={`flex items-end gap-[6px] max-w-full ${isSelf ? "justify-end" : "justify-start"}`}
                style={{ paddingTop: "calc(var(--bubble-font-size) * 0.18)" }}
              >
                <div className={`flex flex-col ${isSelf ? "items-end" : "items-start"}`} style={{ maxWidth: "74%" }}>
                  <div
                    data-bubble
                    className="relative max-w-full break-words whitespace-pre-wrap select-none"
                    style={{
                      padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)",
                      fontSize: "var(--bubble-font-size)",
                      lineHeight: 1.38,
                      overflowWrap: "anywhere",
                      borderRadius: isSelf ? "20px 20px 4px 20px" : "20px 20px 20px 4px",
                      background: isSelf ? selfBubbleColor : "var(--gray-bubble)",
                      color: isSelf ? "#fff" : "var(--gray-text)",
                    }}
                  >
                    {message.text}
                    {status === "closed"
                      && onAcknowledgeClosure
                      && index === messages.length - 1
                      && !isSelf && (
                        <button
                          type="button"
                          className="mt-3 block w-full rounded-full border-none cursor-pointer"
                          style={{
                            padding: "8px 12px",
                            background: selfBubbleColor,
                            color: "#fff",
                            fontFamily: "inherit",
                            fontSize: "calc(var(--bubble-font-size) - 2px)",
                            fontWeight: 600,
                          }}
                          disabled={submitting}
                          onClick={onAcknowledgeClosure}
                        >
                          {t("confirm")}
                        </button>
                      )}
                  </div>
                </div>
              </div>
            );
          })}

          {error && (
            <div className="mt-3 flex justify-start">
              <div
                className="max-w-[88%] rounded-[18px]"
                style={{
                  padding: "calc(var(--bubble-font-size) * 0.52) calc(var(--bubble-font-size) * 0.74)",
                  background: "#fff1f2",
                  color: "#b91c1c",
                  fontSize: "calc(var(--bubble-font-size) - 2px)",
                }}
              >
                {error}
              </div>
            </div>
          )}
        </main>
      </div>

      {status === "open" && (
        <footer
          className="flex-none flex items-end gap-2"
          style={{
            padding: "8px 10px calc(8px + env(safe-area-inset-bottom))",
            background: "var(--composer-bg)",
            backdropFilter: "saturate(180%) blur(20px)",
            WebkitBackdropFilter: "saturate(180%) blur(20px)",
            borderTop: "0.5px solid var(--hairline)",
          }}
        >
          {menuActions.length > 0 && (
            <div ref={menuRef} className="relative self-center">
              <button
                type="button"
                className="flex-none border-none bg-transparent p-0 flex items-center justify-center cursor-pointer"
                style={{ color: "var(--meta)", width: "32px", height: "32px" }}
                aria-label={t("supportMenuActions")}
                onClick={() => setMenuOpen((current) => !current)}
              >
                <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 11px)", height: "calc(var(--bubble-font-size) + 11px)" }}>
                  <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M12 7v10M7 12h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
              {menuOpen && (
                <div
                  className="absolute bottom-[42px] left-0 min-w-[220px] overflow-hidden rounded-[12px]"
                  style={{
                    background: "var(--header-bg)",
                    boxShadow: "0 4px 20px rgba(0,0,0,.15)",
                    backdropFilter: "saturate(180%) blur(20px)",
                    WebkitBackdropFilter: "saturate(180%) blur(20px)",
                  }}
                >
                  {menuActions.map((action, index) => (
                    <button
                      key={action.label}
                      type="button"
                      className="w-full border-none cursor-pointer text-left px-4 py-3 text-[14px]"
                      style={{
                        background: "transparent",
                        color: "var(--gray-text)",
                        borderBottom: index < menuActions.length - 1 ? "0.5px solid var(--hairline)" : "none",
                      }}
                      onClick={() => {
                        setMenuOpen(false);
                        action.onClick();
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              rows={1}
              placeholder={placeholder}
              disabled={submitting || !canSend}
              className="flex-1 border-none bg-transparent outline-none resize-none"
              style={{
                fontSize: "var(--bubble-font-size)",
                color: canSend ? "var(--gray-text)" : "var(--meta)",
                padding: "8px 0",
                caretColor: "var(--tint)",
                fontFamily: "inherit",
                lineHeight: 1.4,
                maxHeight: "80px",
                overflowY: "auto",
              }}
            />
            {draft.trim() && canSend && (
              <button
                type="button"
                onClick={onSend}
                disabled={submitting}
                className="flex-none flex items-center justify-center border-none cursor-pointer"
                style={{
                  width: "calc(var(--bubble-font-size) + 9px)",
                  height: "calc(var(--bubble-font-size) + 9px)",
                  borderRadius: "50%",
                  background: submitting ? "#9ca3af" : selfBubbleColor,
                }}
              >
                <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) - 1px)", height: "calc(var(--bubble-font-size) - 1px)" }}>
                  <path d="M12 20V5m0 0l-6 6m6-6l6 6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
