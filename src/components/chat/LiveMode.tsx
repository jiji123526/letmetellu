"use client";

// Join popup (shown to non-admin when live starts)
export function LivePopup({ title, onJoin, onDismiss }: { title: string; onJoin: () => void; onDismiss: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.5)", padding: "24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      <div style={{ width: "100%", maxWidth: "280px", background: "var(--bg)", borderRadius: "20px", padding: "28px 24px", textAlign: "center" }}>
        <div style={{ marginBottom: "12px" }}>
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#c0392b" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" /><path d="M4.93 4.93a10 10 0 0 1 14.14 0" /><path d="M7.76 7.76a6 6 0 0 1 8.48 0" />
          </svg>
        </div>
        <div style={{ fontSize: "var(--bubble-font-size, 17px)", color: "var(--gray-text)", marginBottom: "8px" }}>{title}</div>
        <div style={{ fontSize: "calc(var(--bubble-font-size) - 2px)", color: "var(--meta)", lineHeight: 1.5, marginBottom: "20px" }}>
          라이브 채팅이 시작되었습니다.<br />참여하시겠습니까?<br />라이브 종료 시 모든 메시지가 삭제됩니다.
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "#f4f4f4", color: "#666" }} onClick={onDismiss}>안할래</button>
          <button style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "#c0392b", color: "#fff" }} onClick={onJoin}>참여</button>
        </div>
      </div>
    </div>
  );
}

// Ended popup
export function LiveEndedPopup({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.5)", padding: "24px" }}
      onClick={onClose}
    >
      <div style={{ width: "100%", maxWidth: "280px", background: "var(--bg)", borderRadius: "20px", padding: "28px 24px", textAlign: "center" }}>
        <div style={{ marginBottom: "12px" }}>
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" /><path d="M4.93 4.93a10 10 0 0 1 14.14 0" /><path d="M7.76 7.76a6 6 0 0 1 8.48 0" />
          </svg>
        </div>
        <div style={{ fontSize: "var(--bubble-font-size, 17px)", color: "var(--gray-text)", marginBottom: "8px" }}>라이브 종료</div>
        <div style={{ fontSize: "calc(var(--bubble-font-size) - 2px)", color: "var(--meta)", lineHeight: 1.5, marginBottom: "20px" }}>라이브 채팅이 종료되었습니다.</div>
        <button style={{ width: "100%", border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "#666", color: "#fff" }} onClick={onClose}>확인</button>
      </div>
    </div>
  );
}

// Title prompt dialog (admin starts live)
export function LiveTitlePrompt({ onStart, onCancel }: { onStart: (title: string) => void; onCancel: () => void }) {
  let inputRef: HTMLInputElement | null = null;
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.4)", padding: "24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{ width: "100%", maxWidth: "300px", background: "var(--bg)", borderRadius: "16px", padding: "20px" }}>
        <div style={{ fontSize: "var(--bubble-font-size, 16px)", fontWeight: 500, color: "var(--gray-text)", marginBottom: "12px" }}>라이브 시작</div>
        <input
          ref={(el) => { inputRef = el; el?.focus(); }}
          type="text"
          placeholder="라이브 제목을 입력하세요"
          style={{ width: "100%", background: "#f4f4f4", border: "1.5px solid #e0e0e0", borderRadius: "12px", padding: "11px 14px", fontSize: "var(--bubble-font-size, 14px)", fontFamily: "inherit", color: "var(--gray-text)", boxSizing: "border-box" as const, outline: "none", lineHeight: 1 }}
          onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--bubble-sent, #3b8df0)"; }}
          onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "#e0e0e0"; }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && inputRef?.value.trim()) { onStart(inputRef.value.trim()); } }}
        />
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "#f4f4f4", color: "#666" }} onClick={onCancel}>취소</button>
          <button style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "#c0392b", color: "#fff" }} onClick={() => { if (inputRef?.value.trim()) onStart(inputRef.value.trim()); }}>시작</button>
        </div>
      </div>
    </div>
  );
}

// Banner shown when live is active but user hasn't joined
export function LiveJoinBanner({ title, onJoin }: { title: string; onJoin: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", background: "#fff0f0", borderTop: "0.5px solid #ffcdd2", borderBottom: "0.5px solid #ffcdd2", flexShrink: 0, lineHeight: 1 }}>
      <span style={{ color: "#c0392b", fontSize: "10px", animation: "livePulse 1.5s infinite" }}>●</span>
      <span style={{ flex: 1, fontSize: "var(--bubble-font-size, 13px)", color: "#c62828" }}>라이브 채팅 진행중: {title}</span>
      <button style={{ background: "#c0392b", color: "#fff", border: "none", borderRadius: "10px", padding: "5px 12px", fontSize: "var(--bubble-font-size, 13px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }} onClick={onJoin}>참여</button>
    </div>
  );
}

// Banner shown when user is inside live mode
export function LiveExitBanner({ isAdmin, title, onExit, viewerCount }: { isAdmin: boolean; title: string; onExit: () => void; viewerCount: number }) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", background: "#fff0f0", borderTop: "0.5px solid #ffcdd2", borderBottom: "0.5px solid #ffcdd2", flexShrink: 0, lineHeight: 1 }}>
      <span style={{ color: "#c0392b", fontSize: "10px", animation: "livePulse 1.5s infinite" }}>●</span>
      <span style={{ flex: 1, fontSize: "var(--bubble-font-size, 13px)", color: "#c62828" }}>라이브 채팅 참여중: {title}</span>
      <button style={{ background: "none", color: "#c0392b", border: "1px solid #c0392b", borderRadius: "10px", padding: "4px 10px", fontSize: "var(--bubble-font-size, 13px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }} onClick={onExit}>{isAdmin ? "종료" : "나가기"}</button>
      {/* Viewer count badge */}
      <div style={{ position: "absolute", top: "calc(100% + 6px)", left: "14px", zIndex: 4, display: "inline-flex", alignItems: "center", gap: "0.28em", padding: "0.28em 0.58em", borderRadius: "999px", background: "rgba(60,60,67,.10)", color: "rgba(60,60,67,.68)", fontSize: "var(--bubble-font-size, 13px)", fontWeight: 600, lineHeight: 1, pointerEvents: "none" }}>
        <svg viewBox="0 0 24 24" style={{ width: "1.05em", height: "1.05em" }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="3.25" /><path d="M5.75 19c.45-4 2.55-6 6.25-6s5.8 2 6.25 6" />
        </svg>
        <span>{viewerCount}</span>
      </div>
    </div>
  );
}
