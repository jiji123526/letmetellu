"use client";

import { useLocale } from "@/hooks/useLocale";

// Join popup (shown to non-admin when live starts)
export function LivePopup({ title, onJoin, onDismiss }: { title: string; onJoin: () => void; onDismiss: () => void }) {
  const { t } = useLocale();
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.5)", padding: "24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      <div style={{ width: "100%", maxWidth: "280px", background: "var(--bg)", borderRadius: "20px", padding: "28px 24px", textAlign: "center" }}>
        <div style={{ marginBottom: "12px", display: "flex", justifyContent: "center" }}>
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#c0392b" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" /><path d="M4.93 4.93a10 10 0 0 1 14.14 0" /><path d="M7.76 7.76a6 6 0 0 1 8.48 0" />
          </svg>
        </div>
        <div style={{ fontSize: "var(--bubble-font-size, 17px)", color: "var(--gray-text)", marginBottom: "8px" }}>{title}</div>
        <div style={{ fontSize: "calc(var(--bubble-font-size) - 2px)", color: "var(--meta)", lineHeight: 1.5, marginBottom: "20px", whiteSpace: "pre-line" }}>
          {t("liveJoinDesc")}
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "var(--card)", color: "var(--secondary-text)" }} onClick={onDismiss}>{ t("liveDismiss")}</button>
          <button style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "#c0392b", color: "#fff" }} onClick={onJoin}>{ t("liveJoin")}</button>
        </div>
      </div>
    </div>
  );
}

// Ended popup
export function LiveEndedPopup({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.5)", padding: "24px" }}
      onClick={onClose}
    >
      <div style={{ width: "100%", maxWidth: "280px", background: "var(--bg)", borderRadius: "20px", padding: "28px 24px", textAlign: "center" }}>
        <div style={{ marginBottom: "12px", display: "flex", justifyContent: "center" }}>
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" /><path d="M4.93 4.93a10 10 0 0 1 14.14 0" /><path d="M7.76 7.76a6 6 0 0 1 8.48 0" />
          </svg>
        </div>
        <div style={{ fontSize: "var(--bubble-font-size, 17px)", color: "var(--gray-text)", marginBottom: "8px" }}>{ t("liveEndedTitle")}</div>
        <div style={{ fontSize: "calc(var(--bubble-font-size) - 2px)", color: "var(--meta)", lineHeight: 1.5, marginBottom: "20px" }}>{ t("liveEndedDesc")}</div>
        <button style={{ width: "100%", border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "#666", color: "#fff" }} onClick={onClose}>{ t("confirm")}</button>
      </div>
    </div>
  );
}

// Title prompt dialog (admin starts live)
export function LiveTitlePrompt({ onStart, onCancel }: { onStart: (title: string) => void; onCancel: () => void }) {
  const { t } = useLocale();
  let inputRef: HTMLInputElement | null = null;
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.4)", padding: "24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{ width: "100%", maxWidth: "300px", background: "var(--bg)", borderRadius: "16px", padding: "20px" }}>
        <div style={{ fontSize: "var(--bubble-font-size, 16px)", fontWeight: 500, color: "var(--gray-text)", marginBottom: "12px" }}>{ t("liveEnterTitle")}</div>
        <input
          ref={(el) => { inputRef = el; el?.focus(); }}
          type="text"
          placeholder={t("liveEnterPlaceholder")}
          style={{ width: "100%", background: "var(--card)", border: "1.5px solid var(--input-border)", borderRadius: "12px", padding: "11px 14px", fontSize: "var(--bubble-font-size, 14px)", fontFamily: "inherit", color: "var(--gray-text)", boxSizing: "border-box" as const, outline: "none", lineHeight: 1 }}
          onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--bubble-sent, #3b8df0)"; }}
          onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--input-border)"; }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && inputRef?.value.trim()) { onStart(inputRef.value.trim()); } }}
        />
        <div style={{ marginTop: "10px", fontSize: "calc(var(--bubble-font-size) - 3px)", color: "var(--meta)", lineHeight: 1.5 }}>
          {t("liveAutoEnds")}
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "var(--card)", color: "var(--secondary-text)" }} onClick={onCancel}>{ t("cancel")}</button>
          <button style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "#c0392b", color: "#fff" }} onClick={() => { if (inputRef?.value.trim()) onStart(inputRef.value.trim()); }}>{ t("liveStartBtn")}</button>
        </div>
      </div>
    </div>
  );
}

// Banner shown when live is active but user hasn't joined
export function LiveJoinBanner({ title, onJoin }: { title: string; onJoin: () => void }) {
  const { t } = useLocale();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", background: "#fff0f0", borderTop: "0.5px solid #ffcdd2", borderBottom: "0.5px solid #ffcdd2", flexShrink: 0, lineHeight: 1 }}>
      <span style={{ color: "#c0392b", fontSize: "10px", animation: "livePulse 1.5s infinite" }}>●</span>
      <span style={{ flex: 1, fontSize: "var(--bubble-font-size, 13px)", color: "#c62828" }}>{t("liveChatActive")}: {title}</span>
      <button style={{ background: "#c0392b", color: "#fff", border: "none", borderRadius: "10px", padding: "5px 12px", fontSize: "var(--bubble-font-size, 13px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }} onClick={onJoin}>{ t("liveJoin")}</button>
    </div>
  );
}

// Banner shown when user is inside live mode
export function LiveExitBanner({ isAdmin, title, onExit, viewerCount, countdownLabel }: { isAdmin: boolean; title: string; onExit: () => void; viewerCount: number; countdownLabel?: string | null }) {
  const { t } = useLocale();
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", background: "#fff0f0", borderTop: "0.5px solid #ffcdd2", borderBottom: "0.5px solid #ffcdd2", flexShrink: 0, lineHeight: 1 }}>
      <span style={{ color: "#c0392b", fontSize: "10px", animation: "livePulse 1.5s infinite" }}>●</span>
      <span style={{ flex: 1, fontSize: "var(--bubble-font-size, 13px)", color: "#c62828" }}>{t("liveChatJoined")}: {title}</span>
      {countdownLabel ? (
        <span style={{ flexShrink: 0, borderRadius: "999px", background: "#c0392b", color: "#fff", padding: "4px 8px", fontSize: "calc(var(--bubble-font-size) - 5px)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {countdownLabel}
        </span>
      ) : null}
      <button style={{ background: "none", color: "#c0392b", border: "1px solid #c0392b", borderRadius: "10px", padding: "4px 10px", fontSize: "var(--bubble-font-size, 13px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }} onClick={onExit}>{isAdmin ? t("liveEndBtn") : t("liveLeave")}</button>
    </div>
  );
}

export function LiveCountdownBanner({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "8px 16px", background: "#c0392b", borderBottom: "0.5px solid #a62f23", flexShrink: 0, color: "#fff", fontSize: "calc(var(--bubble-font-size) - 4px)", fontWeight: 600, lineHeight: 1.2 }}>
      <span style={{ fontSize: "10px", animation: "livePulse 1.1s infinite" }}>●</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{text}</span>
    </div>
  );
}
