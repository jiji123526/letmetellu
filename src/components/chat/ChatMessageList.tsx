"use client";

import React from "react";
import { chatDateKey, chatDateLabel } from "@/lib/chat-date";
import { ReactionBadge } from "./ReactionBadge";
import { MemoizedMessageTextWithEmbeds, MessageImage } from "./ChatMessageContent";
import { isInboxModerationMessage } from "./messageActionRules";
import { stripInboxChannelLine } from "./chatMessageUtils";
import type { Message } from "./chatTypes";

const EMBED_URL_REGEX = /https?:\/\/[^\s<]+/g;

function hasWidgetCaption(text: string): boolean {
  return (text.match(EMBED_URL_REGEX)?.length || 0) > 0
    && text.replace(EMBED_URL_REGEX, "").trim().length > 0;
}

interface MessageRowProps {
  msg: Message;
  isReply: boolean;
  parentIsAdmin: boolean | null;
  replyArrowTone: "default" | "bright";
  effectiveAdmin: boolean;
  uid: string;
  authUserId?: string | null;
  bubbleColor: string;
  isReported: boolean;
  isReportedTarget: boolean;
  searchQuery: string;
  isSearchMatch: boolean;
  isActiveMatch: boolean;
  deletedMessageLabel: string;
  editedMessageLabel: string;
  onLongPress: (msg: Message, isSent: boolean, el: HTMLElement) => void;
  onTouchStart: (msg: Message, isSent: boolean, el: HTMLElement) => void;
  onTouchEnd: () => void;
  onOpenImage: (msg: Message) => void;
  onExpand: (text: string) => void;
  onReaction: (messageId: string, emoji: string) => void;
  onEmojiPicker: (messageId: string, rect: DOMRect) => void;
}

interface MessageListProps {
  threadedMessages: { topLevel: Message[]; repliesMap: Record<string, Message[]> };
  backgroundType: "default" | "color" | "image";
  backgroundColor: string | null;
  backgroundOverlay: number;
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
  onLongPress: MessageRowProps["onLongPress"];
  onTouchStart: MessageRowProps["onTouchStart"];
  onTouchEnd: MessageRowProps["onTouchEnd"];
  onOpenImage: MessageRowProps["onOpenImage"];
  onExpand: MessageRowProps["onExpand"];
  onReaction: MessageRowProps["onReaction"];
  onEmojiPicker: MessageRowProps["onEmojiPicker"];
}

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim();
  const match = normalized.match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const value = match[1];
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function toLinearChannel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: { r: number; g: number; b: number }): number {
  return (
    0.2126 * toLinearChannel(color.r)
    + 0.7152 * toLinearChannel(color.g)
    + 0.0722 * toLinearChannel(color.b)
  );
}

function getReplyArrowTone(input: {
  backgroundType: "default" | "color" | "image";
  backgroundColor: string | null;
  backgroundOverlay: number;
}): "default" | "bright" {
  if (input.backgroundType === "color") {
    const parsed = input.backgroundColor ? parseHexColor(input.backgroundColor) : null;
    if (!parsed) return "default";
    return relativeLuminance(parsed) < 0.42 ? "bright" : "default";
  }
  if (input.backgroundType === "image") {
    return input.backgroundOverlay >= 28 ? "bright" : "default";
  }
  return "default";
}

function resolveMessageBubbleBackground(input: {
  msg: Message;
  effectiveAdmin: boolean;
  isMine: boolean;
  bubbleColor: string;
  isReported: boolean;
  isReportedTarget: boolean;
}): string {
  if (input.msg.report_meta) {
    if (input.msg.report_meta.status === "resolved") return "#dff6e8";
    if (input.msg.report_meta.status === "dismissed") return "#f7ead7";
    return "#eef2ff";
  }
  if (input.msg.petition_meta) {
    if (input.msg.petition_meta.status === "accepted") return "#dff6e8";
    if (input.msg.petition_meta.status === "rejected") return "#f9e2e2";
    return "#eef6ff";
  }
  if (input.msg.report) return "#ffeaea";
  if (input.isReported || (input.effectiveAdmin && !input.msg.report && input.isReportedTarget)) {
    return "#ffe0e0";
  }
  if (input.msg.dm) {
    return input.isMine ? "#7b3fa0" : "#ddc8ed";
  }
  return input.isMine ? input.bubbleColor : "var(--gray-bubble)";
}

const MessageRow = React.memo(function MessageRow({
  msg,
  isReply,
  parentIsAdmin,
  replyArrowTone,
  effectiveAdmin,
  uid,
  authUserId,
  bubbleColor,
  isReported,
  isReportedTarget,
  searchQuery,
  isSearchMatch,
  isActiveMatch,
  deletedMessageLabel,
  editedMessageLabel,
  onLongPress,
  onTouchStart,
  onTouchEnd,
  onOpenImage,
  onExpand,
  onReaction,
  onEmojiPicker,
}: MessageRowProps) {
  const isReportInboxMessage = !!msg.report_meta;
  const isPetitionInboxMessage = !!msg.petition_meta;
  const isFallbackInboxMessage = isInboxModerationMessage(msg);
  const isInboxMessage = isReportInboxMessage || isPetitionInboxMessage;
  const fallbackIsSent = (isInboxMessage || isFallbackInboxMessage)
    ? false
    : (effectiveAdmin ? !!msg.is_admin : !msg.is_admin);
  const parentIsSent = parentIsAdmin !== null
    ? (effectiveAdmin ? parentIsAdmin : !parentIsAdmin)
    : fallbackIsSent;
  const isSent = isReply
    ? parentIsSent
    : fallbackIsSent;
  const isMine = fallbackIsSent;
  const showEmbeds = !!msg.text && !msg.report && !msg.image && !isInboxMessage;
  const hasCaptionedWidget = showEmbeds && hasWidgetCaption(msg.text);
  const usesWideWidgetBubble = hasCaptionedWidget;
  const reportMeta = msg.report_meta;
  const petitionMeta = msg.petition_meta;
  const inboxChannel = reportMeta
    ? {
        channelId: reportMeta.channel_id,
        channelName: reportMeta.channel_name,
      }
    : petitionMeta
      ? {
          channelId: petitionMeta.channel_id,
          channelName: petitionMeta.channel_name,
        }
      : null;
  const reportBubbleStyle = reportMeta?.status === "resolved"
    ? { background: "#dff6e8", color: "#14532d", borderColor: "#71c08d" }
    : reportMeta?.status === "dismissed"
      ? { background: "#f7ead7", color: "#7a4d12", borderColor: "#d6a15c" }
      : reportMeta
        ? { background: "#eef2ff", color: "#243b6b", borderColor: "#aab8eb" }
        : null;
  const petitionBubbleStyle = petitionMeta?.status === "accepted"
    ? { background: "#dff6e8", color: "#14532d", borderColor: "#71c08d" }
    : petitionMeta?.status === "rejected"
      ? { background: "#f9e2e2", color: "#7f1d1d", borderColor: "#df8f8f" }
      : petitionMeta
      ? { background: "#eef6ff", color: "#1d4f77", borderColor: "#9cc4ea" }
      : null;
  const inboxBubbleStyle = reportBubbleStyle || petitionBubbleStyle;
  const bubbleBackground = resolveMessageBubbleBackground({
    msg,
    effectiveAdmin,
    isMine,
    bubbleColor,
    isReported,
    isReportedTarget,
  });

  const bubble = (
    <div
      data-bubble
      className="relative max-w-full break-words whitespace-pre-wrap select-none"
      style={{
        padding: msg.image
          ? "4px 4px 0"
          : "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)",
        fontSize: "var(--bubble-font-size)",
        lineHeight: 1.38,
        overflowWrap: "anywhere",
        boxSizing: "border-box",
        minWidth: 0,
        borderRadius: !isReply
          ? isSent ? "20px 20px 4px 20px" : "20px 20px 20px 4px"
          : "20px",
        background: bubbleBackground,
        color: inboxBubbleStyle?.color || (msg.report
          ? "#c00"
          : isReported || isReportedTarget
            ? "#a00"
            : msg.dm
              ? (isMine ? "#fff" : "#5a1580")
              : isMine ? "#fff" : "var(--gray-text)"),
        border: inboxBubbleStyle ? `1px solid ${inboxBubbleStyle.borderColor}` : "none",
        cursor: msg.report && msg.reported_msg_id ? "pointer" : undefined,
        opacity: isReported ? 0.6 : undefined,
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!msg.deleted || effectiveAdmin) onLongPress(msg, isSent, event.currentTarget);
      }}
      onClick={() => {
        if (!msg.report || !msg.reported_msg_id || !effectiveAdmin) return;
        const element = document.getElementById(`msg-${msg.reported_msg_id}`);
        if (!element) return;
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        const targetBubble = element.querySelector("[data-bubble]") as HTMLElement | null;
        if (!targetBubble) return;
        targetBubble.style.boxShadow = "0 0 0 2px #ff1744 inset";
        targetBubble.style.transition = "box-shadow 0.8s ease-out";
        setTimeout(() => { targetBubble.style.boxShadow = "none"; }, 100);
        setTimeout(() => { targetBubble.style.boxShadow = ""; targetBubble.style.transition = ""; }, 1000);
      }}
      onTouchStart={(event) => {
        if (!msg.deleted) onTouchStart(msg, isSent, event.currentTarget);
      }}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchEnd}
    >
      {msg.deleted ? (
        <span style={{ fontStyle: "italic", opacity: 0.5 }}>{deletedMessageLabel}</span>
      ) : (
        <>
          {inboxChannel && (
            <div style={{ marginBottom: msg.image || msg.text ? "6px" : 0 }}>
              <span>채널: </span>
              <a
                href={`/ch/${encodeURIComponent(inboxChannel.channelId)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                style={{
                  color: "var(--bubble-sent, #3598fe)",
                  textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                {inboxChannel.channelName} (/ch/{inboxChannel.channelId})
              </a>
            </div>
          )}
          {msg.image && <MessageImage src={msg.image} onOpen={() => onOpenImage(msg)} />}
          {msg.text && (
            <MemoizedMessageTextWithEmbeds
              key={`${msg.id}:${msg.text}:${msg.report_meta?.channel_id || msg.petition_meta?.channel_id || ""}`}
              text={isInboxMessage ? stripInboxChannelLine(msg.text) : msg.text}
              image={!!msg.image}
              isMine={isMine}
              searchQuery={searchQuery}
              isSearchMatch={isSearchMatch}
              isActiveMatch={isActiveMatch}
              showEmbeds={showEmbeds}
              fillWidgetWidth={hasCaptionedWidget}
              editedLabel={msg.image && msg.edited ? editedMessageLabel : undefined}
              onExpand={onExpand}
            />
          )}
          {!!msg.edited && !(msg.image && msg.text) && (
            <span
              style={{
                display: msg.image ? "block" : undefined,
                padding: msg.image
                  ? "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)"
                  : undefined,
                fontSize: "calc(var(--bubble-font-size) - 6px)",
                opacity: 0.6,
                fontStyle: "italic",
                marginLeft: msg.image ? 0 : "4px",
              }}
            >
              {editedMessageLabel}
            </span>
          )}
        </>
      )}
    </div>
  );

  const replyArrow = isReply ? (
    <span
      className="flex flex-none items-center"
      style={{
        color: replyArrowTone === "bright" ? "rgba(255,255,255,0.92)" : "var(--meta)",
        opacity: replyArrowTone === "bright" ? 0.92 : 0.7,
        marginTop: "8px",
        transform: parentIsSent ? "scaleY(-1)" : "scaleX(-1) scaleY(-1)",
      }}
    >
      <svg viewBox="0 0 16 16" style={{ width: "var(--bubble-font-size)", height: "var(--bubble-font-size)" }}>
        <path
          d="M14 12C14 8 11 5 7 5H3M3 5l3-3M3 5l3 3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  ) : null;

  return (
    <div
      id={`msg-${msg.id}`}
      className={`flex items-end gap-[6px] max-w-full ${isSent ? "justify-end" : "justify-start"}`}
      style={{
        paddingTop: "calc(var(--bubble-font-size) * 0.32)",
        paddingLeft: isReply && !parentIsSent ? "calc(var(--bubble-font-size) + 8px)" : undefined,
        paddingRight: isReply && parentIsSent ? "calc(var(--bubble-font-size) + 8px)" : undefined,
      }}
    >
      <div
        className={`flex flex-col ${isSent ? "items-end" : "items-start"}`}
        style={{
          width: hasCaptionedWidget
            ? "calc(320px + var(--bubble-font-size) * 1.176)"
            : undefined,
          maxWidth: usesWideWidgetBubble
            ? `min(100%, calc(${isReply ? "85%" : "74%"} + var(--bubble-font-size) * 1.648))`
            : isReply ? "85%" : "74%",
          minWidth: 0,
        }}
      >
        {isReply ? (
          <div
            className={`flex items-start gap-1 ${parentIsSent ? "justify-end" : "justify-start"}`}
            style={{ maxWidth: "100%", minWidth: 0 }}
          >
            {parentIsSent ? <>{bubble}{replyArrow}</> : <>{replyArrow}{bubble}</>}
          </div>
        ) : bubble}
        {!msg.dm && (
          <ReactionBadge
            messageId={msg.id}
            reactions={msg.reactions}
            myUid={effectiveAdmin && authUserId ? authUserId : uid}
            isSent={isSent}
            isReply={isReply}
            onReaction={onReaction}
            onEmojiPicker={onEmojiPicker}
          />
        )}
      </div>
    </div>
  );
});

export const MessageList = React.memo(function MessageList({
  threadedMessages,
  backgroundType,
  backgroundColor,
  backgroundOverlay,
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
}: MessageListProps) {
  const messagesById = new Map<string, Message>();
  for (const message of threadedMessages.topLevel) {
    messagesById.set(message.id, message);
  }
  for (const replies of Object.values(threadedMessages.repliesMap)) {
    for (const reply of replies) {
      messagesById.set(reply.id, reply);
    }
  }

  const replyArrowTone = getReplyArrowTone({
    backgroundType,
    backgroundColor,
    backgroundOverlay,
  });
  const commonProps = {
    effectiveAdmin,
    uid,
    authUserId,
    bubbleColor,
    replyArrowTone,
    deletedMessageLabel,
    editedMessageLabel,
    onLongPress,
    onTouchStart,
    onTouchEnd,
    onOpenImage,
    onExpand,
    onReaction,
    onEmojiPicker,
  };

  return threadedMessages.topLevel.flatMap((message, messageIndex) => {
    const previousMessage = threadedMessages.topLevel[messageIndex - 1];
    const currentDateKey = chatDateKey(message.created_at, timeZone);
    const parentMessage = message.reply_to ? messagesById.get(message.reply_to) : undefined;
    const showDate = Boolean(currentDateKey) && (
      !previousMessage || chatDateKey(previousMessage.created_at, timeZone) !== currentDateKey
    );
    const rows: React.ReactElement[] = [
      ...(showDate ? [
        <div
          key={`date-${message.id}`}
          className="self-center"
          style={{
            color: replyArrowTone === "bright" ? "rgba(255,255,255,0.92)" : "var(--meta)",
            fontSize: "calc(var(--bubble-font-size, 17px) - 4px)",
            fontWeight: 400,
            margin: "16px 0 8px",
            letterSpacing: ".1px",
          }}
        >
          {chatDateLabel(message.created_at, locale, timeZone)}
        </div>,
      ] : []),
      <MessageRow
        key={message.id}
        {...commonProps}
        msg={message}
        isReply={!!message.reply_to}
        parentIsAdmin={parentMessage ? !!parentMessage.is_admin : null}
        isReported={reportedMsgIds.has(message.id)}
        isReportedTarget={reportedTargetIds.has(message.id)}
        searchQuery={searchQuery}
        isSearchMatch={searchResultIdSet.has(message.id)}
        isActiveMatch={message.id === activeSearchId}
      />,
    ];

    for (const reply of threadedMessages.repliesMap[message.id] || []) {
      rows.push(
        <MessageRow
          key={reply.id}
          {...commonProps}
          msg={reply}
          isReply
          parentIsAdmin={!!message.is_admin}
          isReported={reportedMsgIds.has(reply.id)}
          isReportedTarget={reportedTargetIds.has(reply.id)}
          searchQuery={searchQuery}
          isSearchMatch={searchResultIdSet.has(reply.id)}
          isActiveMatch={reply.id === activeSearchId}
        />,
      );
    }

    return rows;
  });
});
