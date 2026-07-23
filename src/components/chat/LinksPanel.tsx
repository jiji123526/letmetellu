"use client";

import { useMemo } from "react";

interface Message {
  id: string;
  text: string;
  created_at: string;
}

interface LinkItem {
  url: string;
  msgId: string;
}

interface LinksPanelProps {
  messages: Message[];
  onNavigate?: (msgId: string) => void;
  onClose: () => void;
}

const URL_REGEX = /(https?:\/\/[^\s]+|(?:www\.|(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|dev|app|co|me|tv|gg|xyz|kr|jp))[^\s]*)/g;

export function LinksPanel({ messages, onNavigate, onClose }: LinksPanelProps) {
  const links = useMemo(() => {
    const found: LinkItem[] = [];
    messages.forEach((m) => {
      if (m.text) {
        const matches = m.text.match(URL_REGEX);
        if (matches) {
          matches.forEach((url) => {
            const fullUrl = url.startsWith("http") ? url : `https://${url}`;
            found.push({ url: fullUrl, msgId: m.id });
          });
        }
      }
    });
    // Deduplicate by URL, keep first occurrence
    const seen = new Map<string, LinkItem>();
    found.forEach((l) => { if (!seen.has(l.url)) seen.set(l.url, l); });
    return [...seen.values()].reverse();
  }, [messages]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center animate-[ctxFade_0.2s_ease]"
      style={{
        background: "rgba(0,0,0,.4)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        padding: "24px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[360px] max-h-[80vh] rounded-[16px] overflow-hidden flex flex-col"
        style={{ background: "var(--bg)", color: "var(--gray-text)", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between flex-none" style={{ padding: "16px 18px", borderBottom: "0.5px solid var(--hairline)" }}>
          <h3 className="m-0 font-medium" style={{ fontSize: "var(--bubble-font-size, 16px)" }}>
            <svg viewBox="0 0 24 24" width="16" height="16" style={{ verticalAlign: "-2px", display: "inline" }}>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {" "}링크
          </h3>
          <button
            className="bg-transparent border-none cursor-pointer"
            style={{ fontSize: "18px", color: "var(--meta)", padding: "4px 8px" }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Links grid */}
        <div className="overflow-y-auto" style={{ padding: "8px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
          {links.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", padding: "40px", textAlign: "center", color: "var(--meta)", fontSize: "var(--bubble-font-size, 14px)" }}>
              공유된 링크가 없습니다
            </div>
          ) : (
            links.map((link, i) => (
              <div
                key={i}
                className="cursor-pointer"
                style={{
                  border: "1px solid var(--hairline)",
                  borderRadius: "12px",
                  overflow: "hidden",
                  transition: "background .15s",
                }}
                onClick={() => {
                  if (onNavigate) {
                    onClose();
                    onNavigate(link.msgId);
                  } else {
                    window.open(link.url, "_blank");
                  }
                }}
              >
                <div style={{
                  padding: "12px",
                  fontSize: "calc(var(--bubble-font-size, 17px) - 3px)",
                  color: "var(--tint)",
                  wordBreak: "break-all",
                }}>
                  {link.url}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
