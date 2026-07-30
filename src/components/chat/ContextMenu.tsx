"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "@/hooks/useLocale";

const REACTIONS = ["👍", "👎", "🫪", "❓"];

interface ContextMenuProps {
  msg: {
    id: string;
    uid: string;
    text: string;
    is_admin: number;
    dm?: boolean;
    report_meta?: {
      report_id: string;
      channel_url: string;
      status: "open" | "resolved" | "dismissed";
      moderation_status: "active" | "warned" | "suspended" | "frozen";
      petition_status: "none" | "open" | "accepted" | "rejected";
    };
    petition_meta?: {
      petition_id: string;
      channel_url: string;
      status: "open" | "accepted" | "rejected";
    };
  };
  isSent: boolean;
  anchorRect: DOMRect;
  bubbleEl: HTMLElement;
  isAdmin: boolean;
  onReaction: (msgId: string, emoji: string) => void;
  onReply: (msgId: string) => void;
  onReport?: (msgId: string) => void;
  onUnreport?: (msgId: string) => void;
  isReported?: boolean;
  onDelete?: (msgId: string) => void;
  onDeleteWithReplies?: (msgId: string) => void;
  onEdit?: (msgId: string) => void;
  onBlock?: (msg: { id: string; uid: string; text: string; dm?: boolean }) => void;
  isBlockedUser?: boolean;
  onReportAction?: (action: "warn_owner" | "freeze_channel" | "unfreeze_channel" | "delete_channel" | "resolve" | "dismiss") => void;
  onPetitionAction?: (action: "accept_petition" | "reject_petition" | "unfreeze_channel") => void;
  reportActionPending?: boolean;
  onEmojiPicker: (msgId: string, rect: DOMRect) => void;
  onClose: () => void;
  isMyMessage: boolean;
}

export function ContextMenu({
  msg,
  isSent,
  anchorRect,
  bubbleEl,
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
  isBlockedUser,
  onReportAction,
  onPetitionAction,
  reportActionPending,
  onEmojiPicker,
  onClose,
  isMyMessage,
}: ContextMenuProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { t } = useLocale();

  // Calculate positioning first
  const bubbleHeight = anchorRect.bottom - anchorRect.top;
  const gap = 8;
  const reactionBarH = 48;
  const safeTop = 60;
  const actionEstimate = 80;

  const composerTop = typeof window !== "undefined" ? window.innerHeight - 60 : 700;
  const normalActionY = anchorRect.bottom + gap;

  const spaceAbove = anchorRect.top - safeTop;
  const needsDownShift = spaceAbove < reactionBarH + gap;
  const needsUpShift = normalActionY + actionEstimate > composerTop;

  let reactionY: number;
  let actionY: number;
  let bubbleShift = 0;

  if (needsDownShift && !needsUpShift) {
    actionY = anchorRect.bottom + gap;
    reactionY = safeTop;
  } else if (needsUpShift) {
    const availableForActions = composerTop - gap;
    const targetBubbleBottom = availableForActions - actionEstimate - gap;
    const targetBubbleTop = targetBubbleBottom - bubbleHeight;
    bubbleShift = anchorRect.top - targetBubbleTop;
    actionY = targetBubbleBottom + gap;
    reactionY = Math.max(targetBubbleTop - gap - reactionBarH, safeTop);
  } else {
    actionY = normalActionY;
    reactionY = anchorRect.top - gap - reactionBarH;
  }

  const positionStyle: React.CSSProperties = isSent
    ? { right: typeof window !== "undefined" ? window.innerWidth - anchorRect.right : 0, left: "auto" }
    : { left: anchorRect.left, right: "auto" };
  const maxActionHeight = Math.max(120, composerTop - actionY - gap);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Elevate the bubble above the overlay
  useEffect(() => {
    bubbleEl.style.position = "relative";
    bubbleEl.style.zIndex = "101";
    bubbleEl.style.boxShadow = "0 4px 20px rgba(0,0,0,.15)";
    bubbleEl.style.filter = "brightness(1.2)";
    if (bubbleShift > 0) {
      bubbleEl.style.transition = "transform .2s ease";
      bubbleEl.style.transform = `translateY(-${bubbleShift}px)`;
    }
    return () => {
      bubbleEl.style.position = "";
      bubbleEl.style.zIndex = "";
      bubbleEl.style.boxShadow = "";
      bubbleEl.style.filter = "";
      bubbleEl.style.transform = "";
      bubbleEl.style.transition = "";
    };
  });

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
  const isReportInboxMessage = isAdmin && !!msg.report_meta;
  const isPetitionInboxMessage = isAdmin && !!msg.petition_meta;
  const isOpenReport = msg.report_meta?.status === "open";
  const isOpenPetition = msg.petition_meta?.status === "open";
  const useScrollableActionList = isReportInboxMessage || isPetitionInboxMessage;

  const ActionButton = ({
    label,
    color,
    borderBottom = true,
    disabled = false,
    onClick,
    icon,
  }: {
    label: string;
    color?: string;
    borderBottom?: boolean;
    disabled?: boolean;
    onClick: () => void;
    icon: React.ReactNode;
  }) => (
    <button
      style={{ ...actionItemStyle, ...(borderBottom ? null : { borderBottom: "none" }) }}
      disabled={disabled}
      onClick={() => {
        onClick();
        onClose();
      }}
    >
      {icon}
      <span style={{ color: color || "var(--gray-text)", opacity: disabled ? 0.65 : 1 }}>{label}</span>
    </button>
  );

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] animate-[ctxFade_0.2s_ease]"
      style={{ background: "rgba(0,0,0,.25)" }}
      onClick={onClose}
    >
      {/* Reaction bar */}
      {!isReportInboxMessage && !isPetitionInboxMessage && (
        <div
          className="absolute flex animate-[ctxPop_0.2s_ease]"
          style={{
            ...positionStyle,
            top: reactionY,
            gap: "4px",
            borderRadius: "22px",
            padding: "6px 8px",
            background: "color-mix(in srgb, var(--card) 88%, transparent)",
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
      )}

      {/* Action list */}
      <div
        className="absolute rounded-[14px] overflow-hidden animate-[ctxPop_0.2s_ease]"
        style={{
          ...positionStyle,
          top: actionY,
          background: "color-mix(in srgb, var(--card) 92%, transparent)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          boxShadow: "0 4px 20px rgba(0,0,0,.15)",
          ...(useScrollableActionList
            ? {
                maxHeight: `${maxActionHeight}px`,
                overflowY: "auto" as const,
                overscrollBehavior: "contain" as const,
              }
            : null),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {isReportInboxMessage ? (
          <>
            {isOpenReport && onReportAction && msg.report_meta?.moderation_status === "active" && (
              <ActionButton
                label={t("warnOwner")}
                disabled={reportActionPending}
                onClick={() => onReportAction("warn_owner")}
                icon={(
                  <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#b26a00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 9v4" />
                    <path d="M12 17h.01" />
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  </svg>
                )}
              />
            )}
            {isOpenReport && onReportAction && msg.report_meta?.moderation_status !== "frozen" && (
              <ActionButton
                label={t("freezeReportedChannel")}
                color="#8b5cf6"
                disabled={reportActionPending}
                onClick={() => onReportAction("freeze_channel")}
                icon={(
                  <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v18" />
                    <path d="M6 8h12" />
                    <path d="M7 15h10" />
                  </svg>
                )}
              />
            )}
            {onReportAction && msg.report_meta?.moderation_status === "frozen" && (
              <ActionButton
                label={t("unfreezeReportedChannel")}
                color="#2a9d4e"
                disabled={reportActionPending}
                onClick={() => onReportAction("unfreeze_channel")}
                icon={(
                  <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#2a9d4e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12h16" />
                    <path d="m9 7-5 5 5 5" />
                    <path d="M15 7l5 5-5 5" />
                  </svg>
                )}
              />
            )}
            {onReportAction && msg.report_meta?.moderation_status === "frozen" && (
              <ActionButton
                label={t("deleteReportedChannel")}
                color="#d32f2f"
                disabled={reportActionPending}
                onClick={() => onReportAction("delete_channel")}
                icon={(
                  <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#d32f2f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                  </svg>
                )}
              />
            )}
            {isOpenReport && onReportAction && (
              <ActionButton
                label={t("resolveReport")}
                color="#2a9d4e"
                disabled={reportActionPending}
                onClick={() => onReportAction("resolve")}
                icon={(
                  <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#2a9d4e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              />
            )}
            {isOpenReport && onReportAction && (
              <ActionButton
                label={t("dismissReport")}
                color="#8e8e93"
                borderBottom={false}
                disabled={reportActionPending}
                onClick={() => onReportAction("dismiss")}
                icon={(
                  <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#8e8e93" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                )}
              />
            )}
            {!isOpenReport && (
              <div style={{ ...actionItemStyle, borderBottom: "none", cursor: "default", color: "var(--meta)" }}>
                <span>{msg.report_meta?.status === "resolved" ? t("reportStatusResolved") : t("reportStatusDismissed")}</span>
              </div>
            )}
          </>
        ) : isPetitionInboxMessage ? (
          <>
            {isOpenPetition && onPetitionAction && (
              <ActionButton
                label={t("acceptPetition")}
                color="#2a9d4e"
                disabled={reportActionPending}
                onClick={() => onPetitionAction("accept_petition")}
                icon={(
                  <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#2a9d4e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              />
            )}
            {isOpenPetition && onPetitionAction && (
              <ActionButton
                label={t("rejectPetition")}
                color="#d32f2f"
                borderBottom={false}
                disabled={reportActionPending}
                onClick={() => onPetitionAction("reject_petition")}
                icon={(
                  <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#d32f2f" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                )}
              />
            )}
            {!isOpenPetition && msg.petition_meta?.status === "rejected" && onPetitionAction && (
              <ActionButton
                label={t("unfreezeReportedChannel")}
                color="#2a9d4e"
                borderBottom={false}
                disabled={reportActionPending}
                onClick={() => onPetitionAction("unfreeze_channel")}
                icon={(
                  <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#2a9d4e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12h16" />
                    <path d="m9 7-5 5 5 5" />
                    <path d="M15 7l5 5-5 5" />
                  </svg>
                )}
              />
            )}
            {!isOpenPetition && msg.petition_meta?.status !== "rejected" && (
              <div style={{ ...actionItemStyle, borderBottom: "none", cursor: "default", color: "var(--meta)" }}>
                <span>{msg.petition_meta?.status === "accepted" ? t("petitionAccepted") : t("petitionRejected")}</span>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Reply — always shown */}
            <button style={actionItemStyle} onClick={() => { onReply(msg.id); onClose(); }}>
              <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 4l-7 7 7 7" />
                <path d="M2 11h14a4 4 0 0 1 4 4v4" />
              </svg>
              <span>{t("reply")}</span>
            </button>

            {/* Admin viewing own: Edit + Delete */}
            {isAdmin && isMyMessage && onEdit && msg.text && (
              <button style={actionItemStyle} onClick={() => { onEdit(msg.id); onClose(); }}>
                <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span>{t("edit")}</span>
              </button>
            )}

            {isAdmin && isMyMessage && onDelete && (
              <button style={{ ...actionItemStyle, color: "#d32f2f", borderBottom: "none" }} onClick={() => { onDelete(msg.id); onClose(); }}>
                <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#d32f2f" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
                <span>{t("delete")}</span>
              </button>
            )}

            {/* Admin viewing others: Delete (with replies) + Block */}
            {isAdmin && !isMyMessage && onDeleteWithReplies && (
              <button style={{ ...actionItemStyle, color: "#d32f2f" }} onClick={() => { onDeleteWithReplies(msg.id); onClose(); }}>
                <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#d32f2f" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
                <span>{t("delete")}</span>
              </button>
            )}

            {isAdmin && !isMyMessage && onBlock && (
              <button style={{ ...actionItemStyle, color: isBlockedUser ? "#2a9d4e" : "#d32f2f", borderBottom: "none" }} onClick={() => { onBlock(msg); onClose(); }}>
                <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke={isBlockedUser ? "#2a9d4e" : "#d32f2f"} strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M4.93 4.93l14.14 14.14" />
                </svg>
                <span>{isBlockedUser ? t("unblock") : t("block")}</span>
              </button>
            )}

            {/* Non-admin viewing own: Edit + Delete */}
            {!isAdmin && isMyMessage && onEdit && msg.text && (
              <button style={actionItemStyle} onClick={() => { onEdit(msg.id); onClose(); }}>
                <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span>{t("edit")}</span>
              </button>
            )}

            {!isAdmin && isMyMessage && onDelete && (
              <button style={{ ...actionItemStyle, color: "#d32f2f", borderBottom: "none" }} onClick={() => { onDelete(msg.id); onClose(); }}>
                <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#d32f2f" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
                <span>{t("delete")}</span>
              </button>
            )}

            {/* Non-admin viewing others: Report / Unreport */}
            {!isAdmin && !isMyMessage && !msg.is_admin && isReported && onUnreport && (
              <button style={{ ...actionItemStyle, borderBottom: "none" }} onClick={() => { onUnreport(msg.id); onClose(); }}>
                <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 4l-7 7 7 7" />
                  <path d="M2 11h20" />
                </svg>
                <span>{t("unreport")}</span>
              </button>
            )}
            {!isAdmin && !isMyMessage && !msg.is_admin && !isReported && onReport && (
              <button style={{ ...actionItemStyle, color: "#d32f2f", borderBottom: "none" }} onClick={() => { onReport(msg.id); onClose(); }}>
                <svg viewBox="0 0 24 24" width="18" height="18" className="flex-shrink-0" fill="none" stroke="#d32f2f" strokeWidth="2">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <path d="M4 22V15" strokeLinecap="round" />
                </svg>
                <span>{t("report")}</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
