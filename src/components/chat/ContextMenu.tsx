"use client";

import { useEffect, useRef } from "react";

const REACTIONS = ["👍", "👎", "🫪", "❓"];

interface ContextMenuProps {
  msg: { id: string; uid: string; text: string; is_admin: number };
  isSent: boolean;
  anchorRect: DOMRect;
  isAdmin: boolean;
  onReaction: (msgId: string, emoji: string) => void;
  onReply: (msgId: string) => void;
  onReport?: (msgId: string) => void;
  onUnreport?: (msgId: string) => void;
  isReported?: boolean;
  onDelete?: (msgId: string) => void;
  onDeleteWithReplies?: (msgId: string) => void;
  onEdit?: (msgId: string) => void;
  onBlock?: (uid: string) => void;
  onEmojiPicker: (msgId: string, rect: DOMRect) => void;
  onClose: () => void;
  isMyMessage: boolean;
}

export function ContextMenu({
  msg,
  isSent,
  anchorRect,
  isAdmin,
  onReaction,
  onReply,
  onReport,
  onUnreport,
  isReported,
  onDelete,
  onDeleteWithReplies,
  onEdit,
  onBlock,
  onEmojiPicker,
  onClose,
  isMyMessage,
}: ContextMenuProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const reactionBarH = 48;
  const gap = 8;
  const reactionY = Math.max(anchorRect.top - gap - reactionBarH, 60);

  const positionStyle: React.CSSProperties = isSent
    ? { right: window.innerWidth - anchorRect.right, left: "auto" }
    : { left: anchorRect.left, right: "auto" };

  const actionItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    width: "100%",
    border: "none",
    background: "none",
    color: "var(--gray-text)",
    fontSize: "var(--bubble-font-size, 17px)",
    fontFamily: "inherit",
    padding: "13px 16px",
    cursor: "pointer",
    borderBottom: "0.5px solid var(--hairline)",
    textAlign: "left" as const,
    lineHeight: 1,
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] animate-[ctxFade_0.2s_ease]"
      style={{ background: "rgba(0,0,0,.25)" }}
      onClick={onClose}
    >
      {/* Reaction bar */}
      <div
        className="absolute flex animate-[ctxPop_0.2s_ease]"
        style={{
          ...positionStyle,
          top: reactionY,
          gap: "4px",
          borderRadius: "22px",
          padding: "6px 8px",
          background: "rgba(255,255,255,.85)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          boxShadow: "0 4px 20px rgba(0,0,0,.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            className="border-none bg-transparent rounded-full cursor-pointer flex items-center justify-center hover:scale-[1.2] active:scale-[1.4] transition-transform"
            style={{
              width: "calc(var(--bubble-font-size) + 19px)",
              height: "calc(var(--bubble-font-size) + 19px)",
              fontSize: "calc(var(--bubble-font-size) + 3px)",
            }}
            onClick={() => {
              onReaction(msg.id, emoji);
              onClose();
            }}
          >
            {emoji}
          </button>
        ))}
        <button
          className="border-none rounded-full cursor-pointer flex items-center justify-center"
          style={{
            width: "calc(var(--bubble-font-size) + 19px)",
            height: "calc(var(--bubble-font-size) + 19px)",
            fontSize: "calc(var(--bubble-font-size) + 1px)",
            background: "var(--hairline)",
            color: "var(--meta)",
            lineHeight: 1,
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onClose();
            onEmojiPicker(msg.id, rect);
          }}
        >
          +
        </button>
      </div>

      {/* Action list */}
      <div
        className="absolute rounded-[14px] overflow-hidden animate-[ctxPop_0.2s_ease]"
        style={{
          ...positionStyle,
          top: anchorRect.bottom + gap,
          background: "rgba(255,255,255,.85)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          boxShadow: "0 4px 20px rgba(0,0,0,.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Reply — always shown */}
        <button style={actionItemStyle} onClick={() => { onReply(msg.id); onClose(); }}>
          <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 4l-7 7 7 7" />
            <path d="M2 11h14a4 4 0 0 1 4 4v4" />
          </svg>
          <span>답장</span>
        </button>

        {/* Admin viewing own: Edit + Delete */}
        {isAdmin && isMyMessage && onEdit && msg.text && (
          <button style={actionItemStyle} onClick={() => { onEdit(msg.id); onClose(); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            <span>수정</span>
          </button>
        )}

        {isAdmin && isMyMessage && onDelete && (
          <button style={{ ...actionItemStyle, color: "#d32f2f", borderBottom: "none" }} onClick={() => { onDelete(msg.id); onClose(); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#d32f2f" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            <span>삭제</span>
          </button>
        )}

        {/* Admin viewing others: Delete (with replies) + Block */}
        {isAdmin && !isMyMessage && onDeleteWithReplies && (
          <button style={{ ...actionItemStyle, color: "#d32f2f" }} onClick={() => { onDeleteWithReplies(msg.id); onClose(); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#d32f2f" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            <span>삭제</span>
          </button>
        )}

        {isAdmin && !isMyMessage && onBlock && (
          <button style={{ ...actionItemStyle, color: "#d32f2f", borderBottom: "none" }} onClick={() => { onBlock(msg.uid); onClose(); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#d32f2f" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M4.93 4.93l14.14 14.14" />
            </svg>
            <span>사용자 차단</span>
          </button>
        )}

        {/* Non-admin viewing own: Edit + Delete */}
        {!isAdmin && isMyMessage && onEdit && msg.text && (
          <button style={actionItemStyle} onClick={() => { onEdit(msg.id); onClose(); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            <span>수정</span>
          </button>
        )}

        {!isAdmin && isMyMessage && onDelete && (
          <button style={{ ...actionItemStyle, color: "#d32f2f", borderBottom: "none" }} onClick={() => { onDelete(msg.id); onClose(); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#d32f2f" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            <span>삭제</span>
          </button>
        )}

        {/* Non-admin viewing others: Report / Unreport */}
        {!isAdmin && !isMyMessage && !msg.is_admin && isReported && onUnreport && (
          <button style={{ ...actionItemStyle, borderBottom: "none" }} onClick={() => { onUnreport(msg.id); onClose(); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 4l-7 7 7 7" />
              <path d="M2 11h20" />
            </svg>
            <span>신고 취소</span>
          </button>
        )}
        {!isAdmin && !isMyMessage && !msg.is_admin && !isReported && onReport && (
          <button style={{ ...actionItemStyle, color: "#d32f2f", borderBottom: "none" }} onClick={() => { onReport(msg.id); onClose(); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#d32f2f" strokeWidth="2">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <path d="M4 22V15" strokeLinecap="round" />
            </svg>
            <span>신고</span>
          </button>
        )}
      </div>
    </div>
  );
}
