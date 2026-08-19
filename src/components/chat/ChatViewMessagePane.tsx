"use client";

import { useCallback, useRef, useState, type RefObject, type TouchEvent } from "react";
import { NoticeBanner } from "./NoticeBanner";
import { MessageList, type SwipeRevealSide, type SwipeRevealState } from "./ChatMessageList";
import type { RestrictedChannelSummaryItem, ThreadedMessages } from "./chatMessageSelectors";
import type { Message } from "./chatTypes";
import { isHorizontalMessageSwipe, messageSwipeOffset } from "./messageSwipe";

interface ChatViewMessagePaneProps {
  channelId: string;
  inLiveMode: boolean;
  backgroundType: "default" | "color" | "image";
  backgroundColor: string | null;
  backgroundImage: string | null;
  backgroundOverlay: number;
  backgroundBlur: boolean;
  activeNotice: string;
  onDismissNotice: () => void;
  liveCount: number;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  isReportsOwnerView: boolean;
  restrictedChannels: RestrictedChannelSummaryItem[];
  restrictedChannelsTitle: string;
  reportModerationFrozenLabel: string;
  reportModerationSuspendedLabel: string;
  reportOpenBadgeLabel: string;
  petitionOpenBadgeLabel: string;
  viewReportedChannelLabel: string;
  threadedMessages: ThreadedMessages;
  effectiveAdmin: boolean;
  uid: string;
  authUserId?: string | null;
  bubbleColor: string;
  reportedMsgIds: Set<string>;
  reportedTargetIds: Set<string>;
  searchQuery: string;
  searchResultIdSet: Set<string>;
  activeSearchId: string | null;
  deletedMessageLabel: string;
  editedMessageLabel: string;
  locale: "ko" | "en";
  timeZone: string;
  onLongPress: (msg: Message, isSent: boolean, el: HTMLElement) => void;
  onTouchStart: (msg: Message, isSent: boolean, el: HTMLElement) => void;
  onTouchEnd: () => void;
  onOpenImage: (msg: Message) => void;
  onExpand: (text: string) => void;
  onReaction: (messageId: string, emoji: string) => void;
  onEmojiPicker: (messageId: string, rect: DOMRect) => void;
}

export function ChatViewMessagePane({
  channelId,
  inLiveMode,
  backgroundType,
  backgroundColor,
  backgroundImage,
  backgroundOverlay,
  backgroundBlur,
  activeNotice,
  onDismissNotice,
  liveCount,
  messagesContainerRef,
  messagesEndRef,
  onScroll,
  isReportsOwnerView,
  restrictedChannels,
  restrictedChannelsTitle,
  reportModerationFrozenLabel,
  reportModerationSuspendedLabel,
  reportOpenBadgeLabel,
  petitionOpenBadgeLabel,
  viewReportedChannelLabel,
  threadedMessages,
  effectiveAdmin,
  uid,
  authUserId,
  bubbleColor,
  reportedMsgIds,
  reportedTargetIds,
  searchQuery,
  searchResultIdSet,
  activeSearchId,
  deletedMessageLabel,
  editedMessageLabel,
  locale,
  timeZone,
  onLongPress,
  onTouchStart,
  onTouchEnd,
  onOpenImage,
  onExpand,
  onReaction,
  onEmojiPicker,
}: ChatViewMessagePaneProps) {
  const [sharedSwipe, setSharedSwipe] = useState<SwipeRevealState>({
    side: null,
    revealOffset: 0,
    isSwiping: false,
  });
  const swipeGestureRef = useRef<{
    startX: number;
    startY: number;
    side: SwipeRevealSide | null;
    axis: "pending" | "horizontal" | "vertical";
  } | null>(null);

  const finishSwipe = useCallback(() => {
    swipeGestureRef.current = null;
    setSharedSwipe((current) => {
      if (current.revealOffset === 0 && !current.isSwiping) return current;
      return {
        side: current.side,
        revealOffset: 0,
        isSwiping: false,
      };
    });
    onTouchEnd();
  }, [onTouchEnd]);

  const handleContainerTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    swipeGestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      side: null,
      axis: "pending",
    };
  }, []);

  const handleContainerTouchMove = useCallback((event: TouchEvent<HTMLElement>) => {
    const gesture = swipeGestureRef.current;
    const touch = event.touches[0];
    if (!gesture || !touch) return;

    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;

    if (gesture.axis === "pending") {
      if (isHorizontalMessageSwipe(deltaX, deltaY)) {
        gesture.axis = "horizontal";
        gesture.side = deltaX < 0 ? "sent" : "received";
        onTouchEnd();
      } else if (Math.abs(deltaY) >= 6 && Math.abs(deltaY) > Math.abs(deltaX)) {
        gesture.axis = "vertical";
        onTouchEnd();
      }
    }
    if (gesture.axis !== "horizontal" || !gesture.side) return;

    const nextOffset = messageSwipeOffset(deltaX, gesture.side === "sent");
    if (nextOffset !== 0) event.preventDefault();
    setSharedSwipe((current) => {
      const revealOffset = Math.abs(nextOffset);
      if (
        current.side === gesture.side
        && current.revealOffset === revealOffset
        && current.isSwiping
      ) {
        return current;
      }
      return {
        side: gesture.side,
        revealOffset,
        isSwiping: true,
      };
    });
  }, [onTouchEnd]);

  return (
    <div
      className="relative flex-1 min-h-0 overflow-hidden"
      style={{
        backgroundColor: backgroundType === "color"
          ? (backgroundColor || "var(--bg)")
          : "var(--bg)",
      }}
    >
      {backgroundType === "image" && backgroundImage && (
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,${backgroundOverlay / 100}), rgba(0,0,0,${backgroundOverlay / 100})), url("${backgroundImage}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: backgroundBlur ? "blur(5px)" : "none",
            transform: backgroundBlur ? "scale(1.04)" : "none",
          }}
        />
      )}

      {(activeNotice || inLiveMode) && (
        <div
          style={{
            position: "absolute",
            top: activeNotice ? "12px" : "14px",
            left: "12px",
            right: activeNotice ? "12px" : "14px",
            zIndex: 12,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "8px",
            pointerEvents: "none",
          }}
        >
          {activeNotice && (
            <NoticeBanner
              channelId={inLiveMode ? `${channelId}_live` : channelId}
              notice={activeNotice}
              onDismiss={onDismissNotice}
            />
          )}

          {inLiveMode && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: "0.28em", padding: "0.28em 0.58em", borderRadius: "999px", background: "rgba(60,60,67,.10)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", color: "rgba(60,60,67,.68)", fontSize: "var(--bubble-font-size, 13px)", fontWeight: 600, lineHeight: 1, pointerEvents: "none" }}>
              <svg viewBox="0 0 24 24" style={{ width: "1.05em", height: "1.05em" }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="3.25" />
                <path d="M5.75 19c.45-4 2.55-6 6.25-6s5.8 2 6.25 6" />
              </svg>
              <span>{liveCount}</span>
            </div>
          )}
        </div>
      )}

      <main
        ref={messagesContainerRef}
        onScroll={onScroll}
        onTouchStart={handleContainerTouchStart}
        onTouchMove={handleContainerTouchMove}
        onTouchEnd={finishSwipe}
        onTouchCancel={finishSwipe}
        className="messages-scroll relative z-[1] h-full overflow-y-auto overflow-x-hidden flex flex-col"
        style={{ padding: "12px 14px 8px", WebkitOverflowScrolling: "touch", overflowAnchor: "none", background: "transparent" }}
      >
        {isReportsOwnerView && restrictedChannels.length > 0 && (
          <section
            style={{
              marginBottom: "12px",
              padding: "12px",
              borderRadius: "18px",
              background: "rgba(255,255,255,0.88)",
              border: "1px solid rgba(15,23,42,0.08)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                marginBottom: "10px",
              }}
            >
              <strong style={{ fontSize: "calc(var(--bubble-font-size) - 1px)", color: "#0f172a" }}>
                {restrictedChannelsTitle}
              </strong>
              <span style={{ fontSize: "calc(var(--bubble-font-size) - 4px)", color: "var(--meta)" }}>
                {restrictedChannels.length}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {restrictedChannels.map((item) => (
                <a
                  key={item.channelId}
                  href={`/ch/${encodeURIComponent(item.channelId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    padding: "10px 12px",
                    borderRadius: "14px",
                    background: "#f8fafc",
                    color: "inherit",
                    textDecoration: "none",
                    border: "1px solid rgba(148,163,184,0.22)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "var(--bubble-font-size)", fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.channelName}
                    </div>
                    <div style={{ marginTop: "5px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "3px 8px",
                          borderRadius: "999px",
                          fontSize: "calc(var(--bubble-font-size) - 5px)",
                          fontWeight: 700,
                          background: item.moderationStatus === "frozen" ? "#fee2e2" : "#fff7d6",
                          color: item.moderationStatus === "frozen" ? "#991b1b" : "#8a5a00",
                        }}
                      >
                        {item.moderationStatus === "frozen" ? reportModerationFrozenLabel : reportModerationSuspendedLabel}
                      </span>
                      {item.hasOpenReport && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "3px 8px",
                            borderRadius: "999px",
                            fontSize: "calc(var(--bubble-font-size) - 5px)",
                            fontWeight: 600,
                            background: "#e0ecff",
                            color: "#1d4ed8",
                          }}
                        >
                          {reportOpenBadgeLabel}
                        </span>
                      )}
                      {item.hasOpenPetition && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "3px 8px",
                            borderRadius: "999px",
                            fontSize: "calc(var(--bubble-font-size) - 5px)",
                            fontWeight: 600,
                            background: "#ede9fe",
                            color: "#6d28d9",
                          }}
                        >
                          {petitionOpenBadgeLabel}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: "calc(var(--bubble-font-size) - 4px)", color: "var(--meta)" }}>
                    {viewReportedChannelLabel}
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}

        <MessageList
          threadedMessages={threadedMessages}
          backgroundType={backgroundType}
          backgroundColor={backgroundColor}
          backgroundOverlay={backgroundOverlay}
          effectiveAdmin={effectiveAdmin}
          uid={uid}
          authUserId={authUserId}
          bubbleColor={bubbleColor}
          reportedMsgIds={reportedMsgIds}
          reportedTargetIds={reportedTargetIds}
          searchQuery={searchQuery}
          searchResultIdSet={searchResultIdSet}
          activeSearchId={activeSearchId}
          deletedMessageLabel={deletedMessageLabel}
          editedMessageLabel={editedMessageLabel}
          locale={locale}
          timeZone={timeZone}
          sharedSwipe={sharedSwipe}
          onLongPress={onLongPress}
          onTouchStart={onTouchStart}
          onOpenImage={onOpenImage}
          onExpand={onExpand}
          onReaction={onReaction}
          onEmojiPicker={onEmojiPicker}
        />
        <div ref={messagesEndRef} />
      </main>
    </div>
  );
}
