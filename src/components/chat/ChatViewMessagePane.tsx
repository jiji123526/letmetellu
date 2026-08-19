"use client";

import { useCallback, useEffect, useRef, type CSSProperties, type RefObject, type TouchEvent } from "react";
import { NoticeBanner } from "./NoticeBanner";
import { MessageList } from "./ChatMessageList";
import type { RestrictedChannelSummaryItem, ThreadedMessages } from "./chatMessageSelectors";
import type { Message } from "./chatTypes";
import { isHorizontalMessageSwipe, messageSwipeOffset } from "./messageSwipe";

type SwipeRevealSide = "sent" | "received";

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
  const swipeLayerRef = useRef<HTMLDivElement>(null);
  const swipeFrameRef = useRef<number | null>(null);
  const swipeResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSwipeRef = useRef<{
    side: SwipeRevealSide;
    offset: number;
  } | null>(null);
  const swipeGestureRef = useRef<{
    startX: number;
    startY: number;
    side: SwipeRevealSide | null;
    axis: "pending" | "horizontal" | "vertical";
  } | null>(null);

  const applySwipeVisual = useCallback((
    side: SwipeRevealSide | null,
    offset: number,
    isSwiping: boolean,
  ) => {
    const layer = swipeLayerRef.current;
    if (!layer) return;
    const revealOffset = Math.abs(offset);
    const opacity = String(Math.min(1, revealOffset / 24));
    layer.style.setProperty("--message-swipe-x", `${offset}px`);
    layer.style.setProperty("--message-swipe-inverse-x", `${-offset}px`);
    layer.style.setProperty("--message-swipe-sent-opacity", side === "sent" ? opacity : "0");
    layer.style.setProperty("--message-swipe-received-opacity", side === "received" ? opacity : "0");
    layer.style.setProperty("--message-swipe-transform-duration", isSwiping ? "0ms" : "180ms");
    layer.style.setProperty("--message-swipe-opacity-duration", isSwiping ? "0ms" : "160ms");
    layer.style.willChange = "transform";
  }, []);

  const finishSwipe = useCallback(() => {
    const side = swipeGestureRef.current?.side || null;
    swipeGestureRef.current = null;
    pendingSwipeRef.current = null;
    if (swipeFrameRef.current !== null) {
      cancelAnimationFrame(swipeFrameRef.current);
      swipeFrameRef.current = null;
    }
    if (side) {
      if (swipeResetTimerRef.current) clearTimeout(swipeResetTimerRef.current);
      applySwipeVisual(side, 0, false);
      swipeResetTimerRef.current = setTimeout(() => {
        swipeLayerRef.current?.style.removeProperty("will-change");
        swipeResetTimerRef.current = null;
      }, 200);
    }
    onTouchEnd();
  }, [applySwipeVisual, onTouchEnd]);

  const handleContainerTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    swipeGestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      side: null,
      axis: "pending",
    };
    if (swipeResetTimerRef.current) {
      clearTimeout(swipeResetTimerRef.current);
      swipeResetTimerRef.current = null;
    }
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
    pendingSwipeRef.current = { side: gesture.side, offset: nextOffset };
    if (swipeFrameRef.current === null) {
      swipeFrameRef.current = requestAnimationFrame(() => {
        swipeFrameRef.current = null;
        const pending = pendingSwipeRef.current;
        if (!pending) return;
        applySwipeVisual(pending.side, pending.offset, true);
      });
    }
  }, [applySwipeVisual, onTouchEnd]);

  useEffect(() => () => {
    if (swipeFrameRef.current !== null) cancelAnimationFrame(swipeFrameRef.current);
    if (swipeResetTimerRef.current) clearTimeout(swipeResetTimerRef.current);
  }, []);

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

        <div
          ref={swipeLayerRef}
          data-message-swipe-layer
          className="flex w-full flex-col"
          style={{
            transform: "translate3d(var(--message-swipe-x, 0px), 0, 0)",
            transition: "transform var(--message-swipe-transform-duration, 180ms) cubic-bezier(0.22, 0.8, 0.3, 1)",
          } as CSSProperties}
        >
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
            onLongPress={onLongPress}
            onTouchStart={onTouchStart}
            onOpenImage={onOpenImage}
            onExpand={onExpand}
            onReaction={onReaction}
            onEmojiPicker={onEmojiPicker}
          />
        </div>
        <div ref={messagesEndRef} />
      </main>
    </div>
  );
}
