"use client";

import { ConfirmDialog } from "./ConfirmDialog";
import { PasscodeOverlay } from "./PasscodeOverlay";
import type { PasscodeGateState } from "./chatViewTypes";
import type { ExpandedPostState } from "./useChatInteractions";

function SkeletonLoading() {
  const rows = [
    { side: "recv", width: "25%" }, { side: "recv", width: "45%" },
    { side: "sent", width: "35%" }, { side: "recv", width: "40%" },
    { side: "sent", width: "25%" }, { side: "sent", width: "55%" },
    { side: "recv", width: "30%" }, { side: "sent", width: "40%" },
    { side: "recv", width: "55%" }, { side: "sent", width: "25%" },
  ];

  return (
    <div className="flex flex-col gap-[3px] p-3 animate-pulse">
      {rows.map((row, index) => (
        <div key={index} className={`flex ${row.side === "sent" ? "justify-end" : "justify-start"}`}>
          <div
            className="rounded-[18px]"
            style={{
              width: row.width,
              height: "calc(var(--bubble-font-size) * 1.38 + 20px)",
              background: row.side === "sent" ? "var(--bubble-sent)" : "var(--gray-bubble)",
              opacity: row.side === "sent" ? 0.5 : 1,
            }}
          />
        </div>
      ))}
    </div>
  );
}

interface ChatViewPasscodeGateProps {
  channelId: string;
  passcodeGate: PasscodeGateState;
  onSuccess: () => void;
}

export function ChatViewPasscodeGate({
  channelId,
  passcodeGate,
  onSuccess,
}: ChatViewPasscodeGateProps) {
  return (
    <PasscodeOverlay
      channelId={channelId}
      channelName={passcodeGate.name}
      profileImage={passcodeGate.profile_image}
      bubbleColor={passcodeGate.bubble_color || "#3598fe"}
      passcodeHint={passcodeGate.passcodeHint}
      notice={passcodeGate.notice}
      onSuccess={onSuccess}
    />
  );
}

interface ChatViewDeletedStateProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export function ChatViewDeletedState({
  title,
  message,
  confirmLabel,
  onConfirm,
}: ChatViewDeletedStateProps) {
  return (
    <div className="h-dvh max-w-[480px] mx-auto relative md:border-x" style={{ background: "var(--bg)", color: "var(--gray-text)", borderColor: "var(--hairline)" }}>
      <ConfirmDialog
        title={title}
        message={message}
        confirmLabel={confirmLabel}
        onConfirm={onConfirm}
        onCancel={() => {}}
        showCancel={false}
        closeOnBackdrop={false}
      />
    </div>
  );
}

export function ChatViewLoadingState() {
  return (
    <div className="h-dvh max-w-[480px] mx-auto flex flex-col md:border-x" style={{ background: "var(--bg)", borderColor: "var(--hairline)" }}>
      <header
        className="flex items-center px-4 border-b relative"
        style={{
          background: "var(--header-bg)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderColor: "var(--hairline)",
          padding: "10px 16px",
        }}
      >
        <div className="flex-1 flex flex-col items-center gap-[6px]">
          <div className="rounded-full" style={{ width: "calc(var(--bubble-font-size) + 24px)", height: "calc(var(--bubble-font-size) + 24px)", background: "var(--gray-bubble)" }} />
          <div className="h-3 w-16 rounded" style={{ background: "var(--gray-bubble)" }} />
        </div>
      </header>
      <div className="flex-1 overflow-hidden">
        <SkeletonLoading />
      </div>
    </div>
  );
}

interface ChatViewExpandedPostOverlayProps {
  expandedPost: ExpandedPostState | null;
  onClose: () => void;
}

export function ChatViewExpandedPostOverlay({
  expandedPost,
  onClose,
}: ChatViewExpandedPostOverlayProps) {
  if (!expandedPost) return null;

  return (
    <div
      className="fixed z-[500] flex items-center justify-center"
      style={{
        top: expandedPost.top,
        left: expandedPost.left,
        width: expandedPost.width,
        height: expandedPost.height,
        padding: "12px",
        background: "rgba(0,0,0,0.42)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--bg)", borderRadius: "18px", maxWidth: "400px", width: "100%", maxHeight: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "12px 16px", borderBottom: "1px solid var(--hairline)" }}>
          <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", fontSize: "18px", lineHeight: 1 }} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "16px", fontSize: "var(--bubble-font-size)", lineHeight: 1.6, color: "var(--gray-text)", overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {expandedPost.text}
        </div>
      </div>
    </div>
  );
}
