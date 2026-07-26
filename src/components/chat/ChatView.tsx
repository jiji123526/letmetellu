"use client";

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { clearRoomToken, fetchInit, fetchOwnerChannels, sendMessage as sendMessageApi, sendMessageAsAdmin, deleteMessage, editMessageApi, adminAction, toggleReaction, toggleReactionAsAdmin, sendDm, uploadImage, fetchMessages, fetchGallery } from "@/lib/api";
import { generateFingerprint } from "@/lib/fingerprint";
import { useRealtime } from "@/hooks/useRealtime";
import { useAuth } from "@/hooks/useAuth";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
import { useLocale } from "@/hooks/useLocale";
import { ContextMenu } from "./ContextMenu";
import { ReactionBadge } from "./ReactionBadge";
import { ReplyBar } from "./ReplyBar";
import { ScrollToBottom } from "./ScrollToBottom";
import { WelcomePopup } from "./WelcomePopup";
import { HeaderMenu } from "./HeaderMenu";
import { SettingsPanel } from "./SettingsPanel";
import { NoticePanel } from "./NoticePanel";
import { EmojiPicker } from "./EmojiPicker";
import { GalleryPanel } from "./GalleryPanel";
import { LinksPanel } from "./LinksPanel";
import { PlusMenu } from "./PlusMenu";
import { EditDialog } from "./EditDialog";
import { LivePopup, LiveEndedPopup, LiveJoinBanner, LiveExitBanner, LiveTitlePrompt } from "./LiveMode";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoticeEditDialog } from "./NoticeEditDialog";
import { NoticeBanner } from "./NoticeBanner";
import { SearchBar, highlightText } from "./SearchBar";
import { EmojiBar, spawnEmoji, EmojiPresetPanel } from "./EmojiBar";
import { MessageEmbeds } from "./MessageEmbeds";
import { AdminPanel } from "../admin/AdminPanel";
import { PasscodeOverlay } from "./PasscodeOverlay";
import { MediaLoadingDots } from "./MediaLoadingDots";
import { recordRecentChannel, removeRecentChannel, updateRecentChannelAppearance } from "@/lib/recent-channels";
import { OwnerChannelsPopup } from "./OwnerChannelsPopup";

interface Message {
  id: string;
  uid: string;
  nick: string | null;
  text: string;
  is_admin: number;
  image: string | null;
  reactions: string;
  reply_to: string | null;
  created_at: string;
  channel_id?: string;
  dm?: boolean;
  deleted?: boolean;
  edited?: boolean;
  report?: number;
  reported_msg_id?: string;
}

interface Channel {
  id: string;
  owner_uid: string;
  name: string;
  profile_image: string | null;
  bubble_color: string;
  is_frozen: number;
  notice: string;
  passcode_hint?: string | null;
  owner_name?: string | null;
}

interface InitData {
  channel: Channel;
  messages?: Message[];
  blocked?: { uid: string; reason: string }[];
  viewerBlocked?: boolean;
  dm?: Message[];
  bannerNotice?: string;
  welcomeConfig?: string;
  live?: { active: boolean; title?: string; sessionId?: string } | null;
  emojiPresets?: string | null;
  petitionEnabled?: boolean;
  dmEnabled?: boolean;
  hasPasscode?: boolean;
  passcodeHint?: string;
  adminDataStatus?: "authorized" | "unauthorized";
}

interface ContextMenuState {
  msg: Message;
  isSent: boolean;
  isOwn: boolean;
  rect: DOMRect;
  bubbleEl: HTMLElement;
}

function getOrCreateUid(): string {
  if (typeof window === "undefined") return "ssr";
  const key = "letsplay_uid";
  let uid = localStorage.getItem(key);
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem(key, uid);
  }
  return uid;
}

function compressImage(file: File, maxWidth: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = (maxWidth / w) * h; w = maxWidth; }
      w = Math.round(w);
      h = Math.round(h);
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => resolve({ blob: blob!, width: w, height: h }), "image/jpeg", quality);
    };
    img.src = URL.createObjectURL(file);
  });
}

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

function parseReactions(reactionsStr: string): Record<string, string> {
  try {
    const parsed = JSON.parse(reactionsStr);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function messagesEqual(left: Message, right: Message): boolean {
  return left.id === right.id
    && left.uid === right.uid
    && left.nick === right.nick
    && left.text === right.text
    && left.is_admin === right.is_admin
    && left.image === right.image
    && left.reactions === right.reactions
    && left.reply_to === right.reply_to
    && left.created_at === right.created_at
    && left.channel_id === right.channel_id
    && left.dm === right.dm
    && left.deleted === right.deleted
    && left.edited === right.edited
    && left.report === right.report
    && left.reported_msg_id === right.reported_msg_id;
}

function mergeServerMessageSnapshot(previous: Message[], incoming: Message[]): Message[] {
  if (previous.length === 0) return incoming;
  if (incoming.length === 0) return [];

  const previousById = new Map(previous.map((message) => [message.id, message]));
  const incomingIds = new Set(incoming.map((message) => message.id));
  const oldestIncomingTime = incoming[0]?.created_at || "";
  const merged: Message[] = [];

  // Preserve locally loaded history older than the server snapshot. Within the
  // snapshot window, absence means the server deleted the message.
  for (const message of previous) {
    if (message.created_at < oldestIncomingTime || incomingIds.has(message.id)) {
      merged.push(message);
    }
  }

  const mergedById = new Map(merged.map((message) => [message.id, message]));
  for (const message of incoming) {
    const previousMessage = previousById.get(message.id);
    mergedById.set(
      message.id,
      previousMessage && messagesEqual(previousMessage, message)
        ? previousMessage
        : message,
    );
  }

  return [...mergedById.values()].sort((left, right) =>
    (left.created_at || "").localeCompare(right.created_at || "")
  );
}

// Skeleton loading
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
      {rows.map((row, i) => (
        <div key={i} className={`flex ${row.side === "sent" ? "justify-end" : "justify-start"}`}>
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

// URL regex — matches http(s) URLs and bare domains (www. or common TLDs)
const URL_LINK_REGEX = /(https?:\/\/[^\s<]+|(?:www\.|(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|dev|app|co|me|tv|gg|xyz|kr|jp))(?:\/[^\s<]*)?)/g;
// Render text with clickable links
function linkifyText(text: string, isMine: boolean, hiddenEmbedUrls: Set<string>): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = [];
  let lastIndex = 0;
  const linkColor = isMine ? "rgba(255,255,255,0.9)" : "var(--bubble-sent)";

  for (const match of text.matchAll(URL_LINK_REGEX)) {
    const url = match[0];
    const index = match.index!;

    // Check if this URL will be embedded
    const fullUrl = url.startsWith("http") ? url : `https://${url}`;
    const isEmbedded = hiddenEmbedUrls.has(url) || hiddenEmbedUrls.has(fullUrl);

    // Add text before this URL
    if (index > lastIndex) {
      const before = text.slice(lastIndex, index);
      // Trim trailing whitespace/newline if URL is hidden
      parts.push(isEmbedded ? before.replace(/\s+$/, "") : before);
    }

    if (!isEmbedded) {
      // Render as clickable link
      parts.push(
        <a
          key={`link-${index}`}
          href={fullUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: linkColor, textDecoration: "underline", textUnderlineOffset: "2px" }}
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>
      );
    }
    // else: skip the URL (embed will show it)

    lastIndex = index + url.length;

    // Trim leading whitespace/newline after hidden URL
    if (isEmbedded && lastIndex < text.length) {
      const after = text.slice(lastIndex);
      const trimmed = after.replace(/^\s+/, "");
      lastIndex += after.length - trimmed.length;
    }
  }

  // Remaining text after last URL
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // If everything was embedded URLs and whitespace, return empty
  if (parts.every((p) => typeof p === "string" && !p.trim())) return [];

  return parts;
}

function MessageImage({ src, onOpen }: { src: string; onOpen: () => void }) {
  const { t } = useLocale();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  return (
    <div className="relative inline-block">
      {!loaded && !failed && <MediaLoadingDots />}
      {failed ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setFailed(false);
            setLoaded(false);
            setAttempt((value) => value + 1);
          }}
          style={{ minHeight: "80px", padding: "8px 14px", border: 0, background: "transparent", color: "inherit", fontSize: "calc(var(--bubble-font-size) - 5px)", cursor: "pointer" }}
        >
          {t("retryMedia")}
        </button>
      ) : (
        <img
          key={attempt}
          src={src}
          alt=""
          className="block h-auto rounded-[15px]"
          style={{ display: loaded ? "block" : "none", width: "auto", maxWidth: "100%", objectFit: "contain" }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      {loaded && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          style={{ position: "absolute", top: "6px", right: "6px", width: "24px", height: "24px", border: "none", background: "rgba(0,0,0,.5)", color: "#fff", borderRadius: "6px", fontSize: "14px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
        >
          ⤢
        </button>
      )}
    </div>
  );
}

// Message text with truncation (>1000 chars), linkification, and search highlight
function MessageText({ text, image, isMine, searchQuery, isSearchMatch, isActiveMatch, hiddenEmbedUrls, onExpand }: { text: string; image: boolean; isMine: boolean; searchQuery: string; isSearchMatch: boolean; isActiveMatch: boolean; hiddenEmbedUrls: Set<string>; onExpand: (text: string) => void }) {

  const isLong = text.length > 1000;
  const displayText = isLong ? text.slice(0, 1000) + "…" : text;

  // Linkify and optionally hide embedded URLs
  const parts = linkifyText(displayText, isMine, hiddenEmbedUrls);
  if (parts.length === 0 && hiddenEmbedUrls.size > 0) return null; // Only embedded URLs

  const content = searchQuery && isSearchMatch
    ? highlightText(displayText, searchQuery, isActiveMatch)
    : parts;

  return (
    <>
      <span className="message-text" style={image ? { display: "block", padding: "2px 10px 8px" } : undefined}>
        {content}
        {isLong && (
          <button
            onClick={(e) => { e.stopPropagation(); onExpand(text); }}
            style={{ display: "block", background: "none", border: "none", color: isMine ? "rgba(255,255,255,0.85)" : "var(--bubble-sent, #3b8df0)", cursor: "pointer", padding: "4px 0 0", fontSize: "var(--bubble-font-size)", fontFamily: "inherit", marginLeft: "auto", transform: "rotate(-90deg)", lineHeight: 1 }}
          >
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 13l5 5 5-5" /><path d="M7 6l5 5 5-5" /></svg>
          </button>
        )}
      </span>
    </>
  );
}

function MessageTextWithEmbeds({
  text,
  image,
  isMine,
  searchQuery,
  isSearchMatch,
  isActiveMatch,
  showEmbeds,
  onExpand,
}: {
  text: string;
  image: boolean;
  isMine: boolean;
  searchQuery: string;
  isSearchMatch: boolean;
  isActiveMatch: boolean;
  showEmbeds: boolean;
  onExpand: (text: string) => void;
}) {
  const [hiddenEmbedUrls, setHiddenEmbedUrls] = useState<Set<string>>(() => new Set());
  const handleEmbedReady = useCallback((url: string) => {
    setHiddenEmbedUrls((current) => {
      if (current.has(url)) return current;
      const next = new Set(current);
      next.add(url);
      return next;
    });
  }, []);

  return (
    <>
      <MessageText
        text={text}
        image={image}
        isMine={isMine}
        searchQuery={searchQuery}
        isSearchMatch={isSearchMatch}
        isActiveMatch={isActiveMatch}
        hiddenEmbedUrls={hiddenEmbedUrls}
        onExpand={onExpand}
      />
      {showEmbeds && <MessageEmbeds text={text} isMine={isMine} onEmbedReady={handleEmbedReady} />}
    </>
  );
}

const MemoizedMessageTextWithEmbeds = React.memo(MessageTextWithEmbeds);

interface MessageRowProps {
  msg: Message;
  isReply: boolean;
  parentIsAdmin: boolean | null;
  effectiveAdmin: boolean;
  uid: string;
  authUserId?: string | null;
  bubbleColor: string;
  isReported: boolean;
  isReportedTarget: boolean;
  isBlockedSender: boolean;
  searchQuery: string;
  isSearchMatch: boolean;
  isActiveMatch: boolean;
  deletedMessageLabel: string;
  onLongPress: (msg: Message, isSent: boolean, el: HTMLElement) => void;
  onTouchStart: (msg: Message, isSent: boolean, el: HTMLElement) => void;
  onTouchEnd: () => void;
  onOpenImage: (msg: Message) => void;
  onExpand: (text: string) => void;
  onReaction: (messageId: string, emoji: string) => void;
  onEmojiPicker: (messageId: string, rect: DOMRect) => void;
}

const MessageRow = React.memo(function MessageRow({
  msg,
  isReply,
  parentIsAdmin,
  effectiveAdmin,
  uid,
  authUserId,
  bubbleColor,
  isReported,
  isReportedTarget,
  isBlockedSender,
  searchQuery,
  isSearchMatch,
  isActiveMatch,
  deletedMessageLabel,
  onLongPress,
  onTouchStart,
  onTouchEnd,
  onOpenImage,
  onExpand,
  onReaction,
  onEmojiPicker,
}: MessageRowProps) {
  const { t } = useLocale();
  const parentIsSent = parentIsAdmin !== null
    ? (effectiveAdmin ? parentIsAdmin : !parentIsAdmin)
    : false;
  const isSent = isReply
    ? parentIsSent
    : (effectiveAdmin ? !!msg.is_admin : !msg.is_admin);
  const isMine = effectiveAdmin ? !!msg.is_admin : !msg.is_admin;
  const hasNativeEmbed = !!msg.text && /https?:\/\/(?:(?:twitter\.com|x\.com)\/\w+\/status\/\d+|(?:www\.)?instagram\.com\/(?:p|reel)\/[\w-]+)/i.test(msg.text);

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
        width: hasNativeEmbed ? "100%" : undefined,
        borderRadius: !isReply
          ? isSent ? "20px 20px 4px 20px" : "20px 20px 20px 4px"
          : "20px",
        background: msg.report
          ? "#ffeaea"
          : isReported || (effectiveAdmin && !msg.report && isReportedTarget)
            ? "#ffe0e0"
            : msg.dm
              ? (isMine ? "#7b3fa0" : "#ddc8ed")
              : isMine ? bubbleColor : "var(--gray-bubble)",
        color: msg.report
          ? "#c00"
          : isReported || isReportedTarget
            ? "#a00"
            : msg.dm
              ? (isMine ? "#fff" : "#5a1580")
              : isMine ? "#fff" : "var(--gray-text)",
        cursor: msg.report && msg.reported_msg_id ? "pointer" : undefined,
        opacity: isReported ? 0.6 : (effectiveAdmin && isBlockedSender) ? 0.4 : undefined,
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
      onTouchStart={(event) => { if (!msg.deleted) onTouchStart(msg, isSent, event.currentTarget); }}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchEnd}
    >
      {msg.deleted ? (
        <span style={{ fontStyle: "italic", opacity: 0.5 }}>{deletedMessageLabel}</span>
      ) : (
        <>
          {msg.image && <MessageImage src={msg.image} onOpen={() => onOpenImage(msg)} />}
          {msg.text && (
            <MemoizedMessageTextWithEmbeds
              key={`${msg.id}:${msg.text}`}
              text={msg.text}
              image={!!msg.image}
              isMine={isMine}
              searchQuery={searchQuery}
              isSearchMatch={isSearchMatch}
              isActiveMatch={isActiveMatch}
              showEmbeds={!msg.report && !msg.image}
              onExpand={onExpand}
            />
          )}
          {!!msg.edited && <span style={{ fontSize: "calc(var(--bubble-font-size) - 6px)", opacity: 0.6, fontStyle: "italic", marginLeft: "4px" }}>{t("edited")}</span>}
        </>
      )}
    </div>
  );

  const replyArrow = isReply ? (
    <span className="flex items-center" style={{ color: "var(--meta)", opacity: 0.7, marginTop: "8px", transform: parentIsSent ? "scaleY(-1)" : "scaleX(-1) scaleY(-1)" }}>
      <svg viewBox="0 0 16 16" style={{ width: "var(--bubble-font-size)", height: "var(--bubble-font-size)" }}>
        <path d="M14 12C14 8 11 5 7 5H3M3 5l3-3M3 5l3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  ) : null;

  return (
    <div
      id={`msg-${msg.id}`}
      className={`flex items-end gap-[6px] max-w-full ${isSent ? "justify-end" : "justify-start"}`}
      style={{
        paddingTop: "calc(var(--bubble-font-size) * 0.18)",
        paddingLeft: isReply && !parentIsSent ? "calc(var(--bubble-font-size) + 8px)" : undefined,
        paddingRight: isReply && parentIsSent ? "calc(var(--bubble-font-size) + 8px)" : undefined,
      }}
    >
      <div
        className={`flex flex-col ${isSent ? "items-end" : "items-start"}`}
        style={{
          maxWidth: hasNativeEmbed
            ? `min(100%, calc(${isReply ? "85%" : "74%"} + var(--bubble-font-size) * 1.648))`
            : isReply ? "85%" : "74%",
        }}
      >
        {isReply ? (
          <div className={`flex items-start gap-1 ${parentIsSent ? "justify-end" : "justify-start"}`}>
            {parentIsSent ? <>{bubble}{replyArrow}</> : <>{replyArrow}{bubble}</>}
          </div>
        ) : bubble}
        <ReactionBadge
          messageId={msg.id}
          reactions={msg.reactions}
          myUid={effectiveAdmin && authUserId ? authUserId : uid}
          isSent={isSent}
          isReply={isReply}
          onReaction={onReaction}
          onEmojiPicker={onEmojiPicker}
        />
      </div>
    </div>
  );
});

interface MessageListProps {
  threadedMessages: { topLevel: Message[]; repliesMap: Record<string, Message[]> };
  effectiveAdmin: boolean;
  uid: string;
  authUserId?: string | null;
  bubbleColor: string;
  reportedMsgIds: Set<string>;
  reportedTargetIds: Set<string>;
  blockedUidSet: Set<string>;
  searchQuery: string;
  searchResultIdSet: Set<string>;
  activeSearchId: string | null;
  deletedMessageLabel: string;
  onLongPress: MessageRowProps["onLongPress"];
  onTouchStart: MessageRowProps["onTouchStart"];
  onTouchEnd: MessageRowProps["onTouchEnd"];
  onOpenImage: MessageRowProps["onOpenImage"];
  onExpand: MessageRowProps["onExpand"];
  onReaction: MessageRowProps["onReaction"];
  onEmojiPicker: MessageRowProps["onEmojiPicker"];
}

const MessageList = React.memo(function MessageList({
  threadedMessages,
  effectiveAdmin,
  uid,
  authUserId,
  bubbleColor,
  reportedMsgIds,
  reportedTargetIds,
  blockedUidSet,
  searchQuery,
  searchResultIdSet,
  activeSearchId,
  deletedMessageLabel,
  onLongPress,
  onTouchStart,
  onTouchEnd,
  onOpenImage,
  onExpand,
  onReaction,
  onEmojiPicker,
}: MessageListProps) {
  const commonProps = {
    effectiveAdmin,
    uid,
    authUserId,
    bubbleColor,
    deletedMessageLabel,
    onLongPress,
    onTouchStart,
    onTouchEnd,
    onOpenImage,
    onExpand,
    onReaction,
    onEmojiPicker,
  };

  return threadedMessages.topLevel.flatMap((message) => {
    const rows: React.ReactElement[] = [
      <MessageRow
        key={message.id}
        {...commonProps}
        msg={message}
        isReply={false}
        parentIsAdmin={null}
        isReported={reportedMsgIds.has(message.id)}
        isReportedTarget={reportedTargetIds.has(message.id)}
        isBlockedSender={blockedUidSet.has(message.uid)}
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
          isBlockedSender={blockedUidSet.has(reply.uid)}
          searchQuery={searchQuery}
          isSearchMatch={searchResultIdSet.has(reply.id)}
          isActiveMatch={reply.id === activeSearchId}
        />,
      );
    }

    return rows;
  });
});

export function ChatView({ channelId }: { channelId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<{ uid: string; reason: string }[]>([]);
  const [viewerBlocked, setViewerBlocked] = useState(false);
  const [dmMessages, setDmMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [passcodeGate, setPasscodeGate] = useState<{ name: string; profile_image: string | null; bubble_color: string; passcodeHint?: string; notice?: string } | null>(null);
  const [uid] = useState(getOrCreateUid);
  const [myFingerprint] = useState(() => typeof window !== "undefined" ? generateFingerprint() : "");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [headerMenu, setHeaderMenu] = useState<DOMRect | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [fullViewImage, setFullViewImage] = useState<{ src: string; caption?: string; date?: string; msgId?: string; fromGallery?: boolean } | null>(null);
  const [expandedPost, setExpandedPost] = useState<{ text: string; top: number; left: number; width: number; height: number } | null>(null);
  const [searchState, setSearchState] = useState<{ query: string; activeId: string | null; resultIds: string[] }>({ query: "", activeId: null, resultIds: [] });
  const [showGallery, setShowGallery] = useState(false);
  const [galleryItems, setGalleryItems] = useState<{ id: string; image: string; created_at: string }[]>([]);
  const [galleryHasMore, setGalleryHasMore] = useState(true);
  const galleryLoading = useRef(false);
  const [showLinks, setShowLinks] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showOwnerChannels, setShowOwnerChannels] = useState(false);
  const [showChannelDeleted, setShowChannelDeleted] = useState(false);
  const [ownerChannelCount, setOwnerChannelCount] = useState(1);
  const { isOwner, userId: authUserId } = useAuth(channel?.owner_uid);
  const { t } = useLocale();
  const [manualAdmin] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("isAdmin") === "true";
  });
  const isAdmin = isOwner || manualAdmin;
  const [adminViewAsUser, setAdminViewAsUser] = useState(false);
  const [liveActive, setLiveActive] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`liveActive_${channelId}`) === "true";
  });
  const [inLiveMode, setInLiveMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`inLiveMode_${channelId}`) === "true";
  });

  useEffect(() => {
    if (!channel?.id) return;
    let active = true;
    fetchOwnerChannels(channelId)
      .then((data) => { if (active) setOwnerChannelCount(data.channels?.length || 1); })
      .catch(() => { if (active) setOwnerChannelCount(1); });
    return () => { active = false; };
  }, [channel?.id, channelId]);
  const [liveTitle, setLiveTitle] = useState(() => {
    if (typeof window === "undefined") return t("liveTitle");
    return localStorage.getItem(`liveTitle_${channelId}`) || t("liveTitle");
  });
  const [liveSessionId, setLiveSessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(`liveSession_${channelId}`) || "";
  });
  const [showLivePopup, setShowLivePopup] = useState(false);
  const [showLiveEnded, setShowLiveEnded] = useState(false);
  const [showLiveTitlePrompt, setShowLiveTitlePrompt] = useState(false);
  const [showEndLiveConfirm, setShowEndLiveConfirm] = useState(false);
  const [showEmojiPreset, setShowEmojiPreset] = useState(false);
  const [emojiPresets, setEmojiPresets] = useState<string[] | null>(null);
  const [showNoticeEdit, setShowNoticeEdit] = useState(false);
  const [activeNotice, setActiveNotice] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(`activeNotice_${channelId}`) || "";
  });
  const [welcomeConfig, setWelcomeConfig] = useState("");
  const [petitionEnabled, setPetitionEnabled] = useState(true);
  const [dmEnabled, setDmEnabled] = useState(true);
  const [localBubbleColor, setLocalBubbleColor] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`bubbleColor_${channelId}`);
  });
  const [emojiPicker, setEmojiPicker] = useState<{ msgId: string; rect: DOMRect } | null>(null);
  const [editingMsg, setEditingMsg] = useState<{ id: string; text: string } | null>(null);
  const [plusMenu, setPlusMenu] = useState<DOMRect | null>(null);
  const [dmMode, setDmMode] = useState(false);
  const [banner, setBanner] = useState<{ text: string; color: string } | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<{ blob: Blob; previewUrl: string; width: number; height: number }[]>([]);
  const [reportedMsgIds, setReportedMsgIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem("reportedMsgIds") || "[]")); } catch { return new Set(); }
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initRequestIdRef = useRef(0);
  const initialScrollDoneRef = useRef(false);
  const pendingReactionUpdatesRef = useRef(new Map<string, string>());
  const reactionFrameRef = useRef<number | null>(null);
  const handleReactionRef = useRef<(messageId: string, emoji: string) => void>(() => {});
  const handleLongPressRef = useRef<(msg: Message, isSent: boolean, el: HTMLElement) => void>(() => {});
  const handleTouchStartRef = useRef<(msg: Message, isSent: boolean, el: HTMLElement) => void>(() => {});
  const handleTouchEndRef = useRef<() => void>(() => {});

  useEffect(() => () => {
    if (reactionFrameRef.current !== null) {
      cancelAnimationFrame(reactionFrameRef.current);
    }
  }, []);

  const openExpandedPost = useCallback((text: string) => {
    const rect = messagesContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setExpandedPost({
      text,
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  const { connected, presence, liveCount, subscribe, send } = useRealtime(channelId, uid);

  // Authenticate admin on WebSocket for DM privacy
  const authenticateAdminSocket = useCallback(async () => {
    if (!isOwner || !channelId) return;
    try {
      const response = await fetch(`/api/ws-token?channel=${encodeURIComponent(channelId)}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json() as { token?: string };
      if (data.token) send({ type: "auth-admin", token: data.token });
    } catch {
      // The next reconnect will request a fresh token again.
    }
  }, [isOwner, channelId, send]);

  useEffect(() => {
    authenticateAdminSocket();
  }, [authenticateAdminSocket]);

  // Auto-reload when new version is deployed (only when user has no draft)
  useAutoUpdate(!!(input || pendingPhotos.length > 0 || replyingTo || dmMode));

  // Notify DO of live mode join/leave for viewer count
  useEffect(() => {
    if (inLiveMode) {
      send({ type: "join-live" });
    } else {
      send({ type: "leave-live" });
    }
  }, [inLiveMode, send]);

  const applyInitData = useCallback((data: InitData) => {
    setChannel(data.channel);
    const savedBubbleColor = localStorage.getItem(`bubbleColor_${channelId}`);
    recordRecentChannel({
      id: channelId,
      name: data.channel.name,
      profileImage: data.channel.profile_image,
      bubbleColor: savedBubbleColor || data.channel.bubble_color || "#3b8df0",
      hasPasscode: data.hasPasscode === true,
      ownerName: data.channel.owner_name || "",
    });
    setMessages(data.messages || []);
    setBlockedUsers(data.blocked || []);
    setViewerBlocked(data.viewerBlocked ?? false);
    setDmMessages((data.dm || []).map((dm) => ({ ...dm, dm: true })));
    setActiveNotice(data.bannerNotice || "");
    setWelcomeConfig(data.welcomeConfig || "");
    setPetitionEnabled(data.petitionEnabled ?? true);
    setDmEnabled(data.dmEnabled ?? true);
    if (data.adminDataStatus === "unauthorized") {
      setBanner({ text: t("adminDataAuthFailed"), color: "#d32f2f" });
    }

    if (data.emojiPresets) {
      localStorage.setItem(`liveEmojis_${channelId}_live`, data.emojiPresets);
      try {
        setEmojiPresets(JSON.parse(data.emojiPresets));
      } catch {
        setEmojiPresets(null);
      }
    } else {
      localStorage.removeItem(`liveEmojis_${channelId}_live`);
      setEmojiPresets(null);
    }

    if (data.live?.active) {
      const title = data.live.title || t("liveTitle");
      const sessionId = data.live.sessionId || "";
      setLiveActive(true);
      setLiveTitle(title);
      setLiveSessionId(sessionId);
      localStorage.setItem(`liveActive_${channelId}`, "true");
      localStorage.setItem(`liveTitle_${channelId}`, title);
      if (sessionId) {
        localStorage.setItem(`liveSession_${channelId}`, sessionId);
      } else {
        localStorage.removeItem(`liveSession_${channelId}`);
      }
    } else {
      setLiveActive(false);
      setLiveTitle(t("liveTitle"));
      setLiveSessionId("");
      setInLiveMode(false);
      localStorage.setItem(`liveActive_${channelId}`, "false");
      localStorage.setItem(`inLiveMode_${channelId}`, "false");
      localStorage.removeItem(`liveTitle_${channelId}`);
      localStorage.removeItem(`liveSession_${channelId}`);
    }
  }, [channelId, t]);

  // Load initial data
  useEffect(() => {
    const shouldResumeLive =
      localStorage.getItem(`inLiveMode_${channelId}`) === "true" &&
      localStorage.getItem(`liveActive_${channelId}`) === "true";
    const initChannel = shouldResumeLive ? `${channelId}_live` : channelId;
    const requestId = ++initRequestIdRef.current;
    fetchInit(initChannel)
      .then(async (data: InitData) => {
        if (requestId !== initRequestIdRef.current) return;
        // Check if passcode-gated
        if (data.hasPasscode && !data.messages) {
          setPasscodeGate({ name: data.channel.name, profile_image: data.channel.profile_image, bubble_color: data.channel.bubble_color, passcodeHint: data.passcodeHint });
          setLoading(false);
          return;
        }
        setPasscodeGate(null);
        applyInitData(data);

        // A stale local live flag may have made the first request target the
        // live channel after that live session already ended. In that case,
        // replace the empty live payload with the normal channel payload.
        if (!data.live?.active && initChannel !== channelId) {
          const normalData = await fetchInit(channelId) as InitData;
          if (requestId !== initRequestIdRef.current) return;
          applyInitData(normalData);
        }
        setLoading(false);
      })
      .catch((error) => {
        if (requestId !== initRequestIdRef.current) return;
        console.error(error);
        setLoading(false);
      });
  }, [channelId, applyInitData]);

  const bubbleColor = localBubbleColor || channel?.bubble_color || "#3b8df0";

  // Sync bubble color to CSS variable so var(--bubble-sent) works everywhere
  useEffect(() => {
    document.documentElement.style.setProperty("--bubble-sent", bubbleColor);
  }, [bubbleColor]);

  // Track inLiveMode in a ref so the subscribe callback always has the latest value
  const inLiveModeRef = useRef(inLiveMode);
  useEffect(() => { inLiveModeRef.current = inLiveMode; }, [inLiveMode]);

  // Debounce not needed — local patching handles most events, reconnect does full refetch

  // Listen for realtime updates
  useEffect(() => {
    return subscribe((event) => {
      // New message — append to local array
      if (event.type === "message-new") {
        const msg = event.message as Message;
        // Only add if it belongs to the channel we're viewing
        const viewingChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        if (msg.channel_id === viewingChannel) {
          setMessages((prev) => {
            // Avoid duplicates (e.g. our own message already shown optimistically)
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      }
      // Message edited — patch text in place
      if (event.type === "message-edited") {
        const id = event.message_id as string;
        setMessages((prev) => prev.map((m) =>
          m.id === id ? { ...m, text: event.text as string, edited: true } : m
        ));
      }
      // Message deleted — remove or mark as deleted
      if (event.type === "message-deleted") {
        const id = event.message_id as string;
        const deletedIds = new Set(
          Array.isArray(event.deleted_ids) ? event.deleted_ids as string[] : [id]
        );
        setGalleryItems((prev) => prev.filter((item) => !deletedIds.has(item.id)));
        if (event.soft) {
          // User soft-delete (own message with replies) — keep as placeholder if has replies
          setMessages((prev) => {
            const hasReplies = prev.some((m) => m.reply_to === id);
            if (hasReplies) {
              return prev.map((m) => m.id === id ? { ...m, deleted: true, text: t("deletedMessage"), image: null } : m);
            }
            return prev.filter((m) => m.id !== id);
          });
        } else {
          // Admin hard-delete — remove message and its replies entirely
          setMessages((prev) => prev.filter((m) => m.id !== id && m.reply_to !== id));
        }
      }
      // Reconnect or bulk sync — full refetch as safety net
      if (event.type === "reconnected" || event.type === "messages-sync") {
        const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        fetchMessages(fetchChannel).then((data) => {
          if (data.messages) {
            setMessages((previous) => mergeServerMessageSnapshot(previous, data.messages));
          }
        }).catch(() => {});
      }
      // Re-send join-live on reconnect so DO has accurate count
      if (event.type === "reconnected" && inLiveModeRef.current) {
        send({ type: "join-live" });
      }
      // Always request a fresh short-lived token on reconnect.
      if (event.type === "reconnected") {
        authenticateAdminSocket();
      }
      if (event.type === "dm-new") {
        const dm = event.dm as Message;
        const viewingChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        if (dm.channel_id === viewingChannel) {
          setDmMessages((prev) => {
            if (prev.some((d) => d.id === dm.id)) return prev;
            return [...prev, { ...dm, dm: true }];
          });
        }
      }
      if (event.type === "dm-deleted") {
        const dmId = event.dm_id as string;
        setDmMessages((prev) => prev.filter((d) => d.id !== dmId));
      }
      if (event.type === "freeze-change") {
        const isLiveFreeze = !!event.live;
        if (isLiveFreeze && inLiveModeRef.current) {
          setChannel((prev) => prev ? { ...prev, is_frozen: event.frozen ? 1 : 0 } : null);
        } else if (!isLiveFreeze && !inLiveModeRef.current) {
          setChannel((prev) => prev ? { ...prev, is_frozen: event.frozen ? 1 : 0 } : null);
        }
      }
      if (event.type === "profile-change") {
        updateRecentChannelAppearance(channelId, {
          ...(event.name ? { name: event.name as string } : {}),
          ...(event.profile_image !== undefined ? { profileImage: event.profile_image as string | null } : {}),
          ...(event.bubble_color && !localBubbleColor ? { bubbleColor: event.bubble_color as string } : {}),
        });
        setChannel((prev) => {
          if (!prev) return null;
          const updated = { ...prev };
          if (event.name) updated.name = event.name as string;
          if (event.profile_image !== undefined) updated.profile_image = event.profile_image as string | null;
          if (event.bubble_color) updated.bubble_color = event.bubble_color as string;
          return updated;
        });
      }
      if (event.type === "emoji-fx") {
        spawnEmoji(event.emoji as string, event.x as number, event.h as number);
      }
      if (event.type === "reaction-changed") {
        const msgId = event.message_id as string;
        const newReactions = event.reactions as string;
        pendingReactionUpdatesRef.current.set(msgId, newReactions);
        if (reactionFrameRef.current === null) {
          reactionFrameRef.current = requestAnimationFrame(() => {
            reactionFrameRef.current = null;
            const updates = new Map(pendingReactionUpdatesRef.current);
            pendingReactionUpdatesRef.current.clear();
            setMessages((previous) => {
              let changed = false;
              const next = previous.map((message) => {
                const reactions = updates.get(message.id);
                if (reactions === undefined || reactions === message.reactions) return message;
                changed = true;
                return { ...message, reactions };
              });
              return changed ? next : previous;
            });
          });
        }
      }
      if (event.type === "room-auth-failed") {
        clearRoomToken(channelId);
        setPasscodeGate({
          name: channel?.name || "",
          profile_image: channel?.profile_image || null,
          bubble_color: channel?.bubble_color || "#3b8df0",
          notice: t("roomAuthExpired"),
        });
        setBanner({ text: t("roomAuthExpired"), color: "#d32f2f" });
      }
      if (event.type === "admin-authenticated") {
        const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        fetchInit(fetchChannel).then((data: InitData) => {
          applyInitData(data);
        }).catch(() => {});
      }
      if (event.type === "admin-auth-failed" && isOwner) {
        setBanner({ text: t("adminDataAuthFailed"), color: "#d32f2f" });
      }
      if (event.type === "room-access-opened") {
        setPasscodeGate(null);
        const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        fetchInit(fetchChannel).then((data: InitData) => {
          applyInitData(data);
        }).catch(() => {});
      }
      if (event.type === "room-access-revoked") {
        clearRoomToken(channelId);
        setPasscodeGate({
          name: channel?.name || "",
          profile_image: channel?.profile_image || null,
          bubble_color: channel?.bubble_color || "#3b8df0",
          notice: t("passcodeChanged"),
        });
      }
      if (event.type === "user-blocked") {
        const blockedUid = event.uid as string;
        const blockedFp = event.fingerprint as string | null;
        if (blockedUid === uid || (!!blockedFp && blockedFp === myFingerprint)) {
          setViewerBlocked(true);
        }
        if (isOwner) {
          setBlockedUsers((prev) => {
            if (prev.some((b) => b.uid === blockedUid)) return prev;
            return [...prev, { uid: blockedUid, reason: "" }];
          });
        }
      }
      if (event.type === "user-unblocked") {
        const unblockedUid = event.uid as string;
        const unblockedFp = event.fingerprint as string | null;
        if (unblockedUid === uid || (!!unblockedFp && unblockedFp === myFingerprint)) {
          setViewerBlocked(false);
        }
        setBlockedUsers((prev) => prev.filter((b) => b.uid !== unblockedUid));
      }
      if (event.type === "petition-changed") {
        setPetitionEnabled(!!event.enabled);
      }
      if (event.type === "dm-toggle-changed") {
        setDmEnabled(!!event.enabled);
      }
      if (event.type === "live-ended") {
        localStorage.setItem(`liveActive_${channelId}`, "false");
        localStorage.removeItem(`liveSeen_${channelId}`);
        localStorage.removeItem(`liveTitle_${channelId}`);
        localStorage.removeItem(`liveSession_${channelId}`);
        setLiveActive(false);
        if (inLiveModeRef.current) {
          setInLiveMode(false);
          localStorage.setItem(`inLiveMode_${channelId}`, "false");
          setShowLiveEnded(true);
          // Refetch normal channel state (messages, DMs, notice, freeze state)
          fetchInit(channelId).then((data) => {
            setChannel(data.channel);
            setMessages(data.messages);
            setDmMessages(data.dm ? data.dm.map((d: any) => ({ ...d, dm: true })) : []);
            setActiveNotice(data.bannerNotice || "");
          }).catch(() => {});
        }
      }
      if (event.type === "live-started") {
        const sessionId = (event.sessionId as string) || "";
        setLiveActive(true);
        setLiveTitle((event.title as string) || t("liveTitle"));
        setLiveSessionId(sessionId);
        localStorage.setItem(`liveActive_${channelId}`, "true");
        localStorage.setItem(`liveTitle_${channelId}`, (event.title as string) || t("liveTitle"));
        localStorage.setItem(`liveSession_${channelId}`, sessionId);
        // Show popup only if not already in live mode and haven't dismissed this session
        if (!inLiveModeRef.current) {
          const seen = localStorage.getItem(`liveSeen_${channelId}`);
          if (seen === sessionId) {
            // Already dismissed — just show banner (handled by liveActive + !inLiveMode in render)
          } else {
            setShowLivePopup(true);
          }
        }
      }
      if (event.type === "notice-changed") {
        const isLiveNotice = !!event.live;
        // Only apply if the notice matches user's current mode
        if (isLiveNotice && inLiveModeRef.current) {
          setActiveNotice((event.notice as string) || "");
        } else if (!isLiveNotice && !inLiveModeRef.current) {
          setActiveNotice((event.notice as string) || "");
        }
      }
      if (event.type === "rules-changed") {
        setChannel((prev) => prev ? { ...prev, notice: event.rules as string } : null);
      }
      if (event.type === "channel-deleted" && !isAdmin) {
        removeRecentChannel(channelId);
        setShowChannelDeleted(true);
      }
      if (event.type === "emoji-presets-changed") {
        localStorage.setItem(`liveEmojis_${channelId}_live`, event.emojis as string);
        try { setEmojiPresets(JSON.parse(event.emojis as string)); } catch {}
      }
    });
  }, [subscribe, channelId, send, authenticateAdminSocket, isOwner, isAdmin, uid, myFingerprint, t, channel, applyInitData, localBubbleColor]);

  // Refetch on tab focus only if backgrounded for >5 minutes (safety net for missed broadcasts)
  useEffect(() => {
    let lastHidden = 0;
    const handler = () => {
      if (document.visibilityState === "hidden") {
        lastHidden = Date.now();
      } else if (document.visibilityState === "visible" && lastHidden && Date.now() - lastHidden > 5 * 60 * 1000) {
        const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
        fetchMessages(fetchChannel).then((data) => {
          if (data.messages) {
            setMessages((previous) => mergeServerMessageSnapshot(previous, data.messages));
          }
        });
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [channelId]);

  // Position the initial channel view at the latest message once. Subsequent
  // message mutations (new/edit/delete/reaction/refetch) preserve scroll.
  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [channelId]);

  useEffect(() => {
    if (loading || passcodeGate || initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    });
  }, [loading, passcodeGate]);

  // Scroll detection for scroll-to-bottom button
  const loadingMore = useRef(false);
  const hasMoreMessages = useRef(true);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distanceFromBottom > 200);

    // Load older messages when scrolled to top
    if (el.scrollTop < 50 && !loadingMore.current && hasMoreMessages.current && messages.length > 0) {
      const oldest = messages[0];
      if (!oldest?.created_at) return;
      loadingMore.current = true;
      const prevHeight = el.scrollHeight;
      const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
      fetchMessages(fetchChannel, oldest.created_at).then((data) => {
        if (data.messages && data.messages.length > 0) {
          if (data.messages.length < 50) hasMoreMessages.current = false;
          setMessages((prev) => {
            // Merge avoiding duplicates
            const ids = new Set(prev.map((m) => m.id));
            const older = data.messages.filter((m: Message) => !ids.has(m.id));
            return [...older, ...prev];
          });
          // Preserve scroll position
          requestAnimationFrame(() => {
            if (el) el.scrollTop = el.scrollHeight - prevHeight;
          });
        } else {
          hasMoreMessages.current = false;
        }
      }).finally(() => { loadingMore.current = false; });
    }
  }, [messages, channelId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollBtn(false);
  };

  // Scroll to a specific message by ID — loads older messages if needed
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const scrollToMessage = useCallback(async (msgId: string) => {
    // Try to find it in current DOM
    let el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const bubble = el.querySelector("[data-bubble]") as HTMLElement | null; if (bubble) { bubble.style.transition = "box-shadow .3s"; bubble.style.boxShadow = "0 0 0 2.5px var(--bubble-sent)"; setTimeout(() => { bubble.style.boxShadow = ""; }, 2000); }
      return;
    }

    // Not loaded — load older messages until found
    const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
    let attempts = 0;

    while (attempts < 20) {
      const current = messagesRef.current;
      if (current.length === 0) break;
      const oldest = current[0];
      if (!oldest?.created_at) break;

      const data = await fetchMessages(fetchChannel, oldest.created_at);
      if (!data.messages || data.messages.length === 0) break;

      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const older = data.messages.filter((m: Message) => !ids.has(m.id));
        return [...older, ...prev];
      });

      // Wait for React render
      await new Promise((r) => setTimeout(r, 100));

      el = document.getElementById(`msg-${msgId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const bubble = el.querySelector("[data-bubble]") as HTMLElement | null; if (bubble) { bubble.style.transition = "box-shadow .3s"; bubble.style.boxShadow = "0 0 0 2.5px var(--bubble-sent)"; setTimeout(() => { bubble.style.boxShadow = ""; }, 2000); }
        return;
      }
      attempts++;
    }

    setBanner({ text: "Message not found", color: "var(--meta)" });
    setTimeout(() => setBanner(null), 2000);
  }, [channelId]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 80) + "px";
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingPhotos.length === 0) || (channel?.is_frozen && !effectiveAdmin && !dmMode)) return;

    // Blocked user handling
    if (isUserBlocked) {
      if (hasPetitioned || !petitionEnabled) {
        setBanner({ text: t("blocked"), color: "#d32f2f" });
        setTimeout(() => setBanner(null), 3000);
        return;
      }
      // Send one-time petition DM
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      const blockEntry = blockedUsers.find((b) => b.uid === uid);
      const reason = blockEntry?.reason ? `\n[${t("blockReason")}: "${blockEntry.reason}"]` : "";
      sendDm({ uid, text: `[${t("petitionPrefix")}] ${text}${reason}`, channel_id: inLiveMode ? `${channelId}_live` : channelId });
      localStorage.setItem("petitionSent", uid);
      setBanner({ text: t("petitionSent"), color: "#d32f2f" });
      setTimeout(() => setBanner(null), 3000);
      return;
    }

    // Send photos + text
    const photos = [...pendingPhotos];
    setPendingPhotos([]);
    const savedReplyTo = replyingTo?.id;
    setReplyingTo(null);

    // DM mode
    if (dmMode) {
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setDmMode(false);
      setBanner({ text: t("sentToAdmin"), color: "#7b3fa0" });
      setTimeout(() => setBanner(null), 3000);
      const dmChannelId = inLiveMode ? `${channelId}_live` : channelId;
      const dmImage = photos.length > 0 ? await uploadImage(photos[0].blob, dmChannelId) || undefined : undefined;
      sendDm({ uid, text, channel_id: dmChannelId, image: dmImage });
      return;
    }

    // Dismiss keyboard after send (except in live mode where keyboard stays)
    if (!inLiveMode && textareaRef.current) textareaRef.current.blur();

    const activeChannelId = inLiveMode ? `${channelId}_live` : channelId;

    const sender = effectiveAdmin && authUserId ? sendMessageAsAdmin : sendMessageApi;
    const senderUid = effectiveAdmin && authUserId ? authUserId : uid;
    let sendError: string | undefined;
    let unsentPhotos: typeof photos = [];

    try {
      if (photos.length === 0) {
        const result = await sender({
          uid: senderUid,
          text,
          channel_id: activeChannelId,
          reply_to: savedReplyTo,
          fingerprint: myFingerprint,
        });
        sendError = result.error;
      } else {
        // Match the original behavior: caption/reply on the first image, then
        // send every remaining image as its own consecutive message.
        for (let index = 0; index < photos.length; index += 1) {
          const image = await uploadImage(photos[index].blob, activeChannelId);
          if (!image) {
            sendError = "upload_failed";
            unsentPhotos = photos.slice(index);
            break;
          }

          const result = await sender({
            uid: senderUid,
            text: index === 0 ? text : "",
            channel_id: activeChannelId,
            image,
            reply_to: index === 0 ? savedReplyTo : undefined,
            fingerprint: myFingerprint,
          });

          if (result.error) {
            sendError = result.error;
            unsentPhotos = photos.slice(index);
            break;
          }

          URL.revokeObjectURL(photos[index].previewUrl);
          // The first successful photo already delivered the caption.
          if (index === 0) {
            setInput("");
            if (textareaRef.current) textareaRef.current.style.height = "auto";
          }
        }
      }
    } catch {
      sendError = "network_error";
      unsentPhotos = photos;
    }

    if (sendError) {
      if (unsentPhotos.length > 0) setPendingPhotos(unsentPhotos);
      if (sendError === "message_too_long") setBanner({ text: t("messageTooLong"), color: "#d32f2f" });
      else if (sendError === "banned_word") setBanner({ text: t("bannedWord"), color: "#d32f2f" });
      else if (sendError === "rate_limited") setBanner({ text: t("rateLimited"), color: "#d32f2f" });
      else if (sendError === "blocked") setBanner({ text: t("blocked"), color: "#d32f2f" });
      else if (sendError === "channel frozen") setBanner({ text: t("chatFrozen"), color: "#4a4d8f" });
      else setBanner({ text: t("sendFailed"), color: "#d32f2f" });
      setTimeout(() => setBanner(null), 3000);
    } else {
      // DO broadcasts message-changed → refetch shows each sent message.
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Desktop: Enter sends, Shift+Enter adds new line
    // Mobile: Enter adds new line naturally, user taps send button
    const isMobile = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (e.key === "Enter" && !e.shiftKey && !isMobile && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  // Context menu handlers
  const handleBubbleLongPress = (msg: Message, isSent: boolean, el: HTMLElement) => {
    // Dismiss keyboard
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const rect = el.getBoundingClientRect();
    const isOwn = effectiveAdmin ? !!msg.is_admin : msg.uid === uid;
    setContextMenu({ msg, isSent, isOwn, rect, bubbleEl: el });
  };

  const handleTouchStart = (msg: Message, isSent: boolean, el: HTMLElement) => {
    longPressTimer.current = setTimeout(() => {
      handleBubbleLongPress(msg, isSent, el);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleReaction = async (msgId: string, emoji: string) => {
    const activeChannelId = inLiveModeRef.current ? `${channelId}_live` : channelId;
    const reactionUid = effectiveAdmin && authUserId ? authUserId : uid;

    // Optimistic reaction update
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const reactions = parseReactions(m.reactions);
        const key = `${reactionUid}_${Date.now()}`;
        // Check if user already reacted with this emoji
        const existingKey = Object.entries(reactions).find(
          ([k, v]) => k.startsWith(`${reactionUid}_`) && v === emoji
        )?.[0];
        if (existingKey) {
          delete reactions[existingKey]; // toggle off
        } else {
          reactions[key] = emoji; // add
        }
        return { ...m, reactions: JSON.stringify(reactions) };
      })
    );

    try {
      const toggle = effectiveAdmin && authUserId ? toggleReactionAsAdmin : toggleReaction;
      const result = await toggle({
        uid: reactionUid,
        message_id: msgId,
        channel_id: activeChannelId,
        emoji,
      });

      if (result.error) throw new Error(result.error);

      // Reconcile the optimistic key with the server's canonical reaction map.
      if (result.reactions) {
        setMessages((prev) => prev.map((message) =>
          message.id === msgId
            ? { ...message, reactions: JSON.stringify(result.reactions) }
            : message
        ));
      }
    } catch {
      // A failed optimistic update must not remain visible only to this client.
      fetchMessages(activeChannelId).then((data) => {
        if (data.messages) {
          setMessages((previous) => mergeServerMessageSnapshot(previous, data.messages));
        }
      }).catch(() => {});
      setBanner({ text: t("sendFailed"), color: "#d32f2f" });
      setTimeout(() => setBanner(null), 3000);
    }
  };

  // Effective admin state (false when viewing as user)
  const effectiveAdmin = isAdmin && !adminViewAsUser;

  const displayMessages = useMemo(
    () => effectiveAdmin
      ? [...messages, ...dmMessages].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""))
      : messages.filter((message) => !message.report),
    [effectiveAdmin, messages, dmMessages],
  );
  const blockedUidSet = useMemo(
    () => new Set(blockedUsers.map((blockedUser) => blockedUser.uid)),
    [blockedUsers],
  );
  const reportedTargetIds = useMemo(() => {
    const ids = new Set<string>();
    if (effectiveAdmin) {
      for (const message of displayMessages) {
        if (message.report && message.reported_msg_id) ids.add(message.reported_msg_id);
      }
    }
    return ids;
  }, [effectiveAdmin, displayMessages]);
  const searchResultIdSet = useMemo(
    () => new Set(searchState.resultIds),
    [searchState.resultIds],
  );
  const threadedMessages = useMemo(() => {
    const topLevel: Message[] = [];
    const repliesMap: Record<string, Message[]> = {};
    const messageIds = new Set(displayMessages.map((message) => message.id));
    for (const message of displayMessages) {
      if (message.reply_to && messageIds.has(message.reply_to)) {
        if (!repliesMap[message.reply_to]) repliesMap[message.reply_to] = [];
        repliesMap[message.reply_to].push(message);
      } else {
        topLevel.push(message);
      }
    }
    return { topLevel, repliesMap };
  }, [displayMessages]);

  // Check if current user is blocked
  const isUserBlocked = !effectiveAdmin && (
    viewerBlocked
    || blockedUsers.some((b) => b.uid === uid || (myFingerprint && (b as any).fingerprint === myFingerprint))
  );
  const hasPetitioned = typeof window !== "undefined" && localStorage.getItem("petitionSent") === uid;
  // Reset petition status when unblocked (gives another chance on re-block)
  if (!isUserBlocked && hasPetitioned && typeof window !== "undefined") {
    localStorage.removeItem("petitionSent");
  }

  const handleDelete = (msgId: string) => {
    // Check if this message has replies (if so, soft delete; otherwise hard delete)
    const replyIds = messages.filter((m) => m.reply_to === msgId).map((m) => m.id);
    const hasReplies = replyIds.length > 0;
    if (effectiveAdmin) {
      // Admin: always remove from view immediately
      setMessages((prev) => prev.filter((m) => m.id !== msgId && m.reply_to !== msgId));
      const deletedIds = new Set([msgId, ...replyIds]);
      setGalleryItems((prev) => prev.filter((item) => !deletedIds.has(item.id)));
      const msg = messages.find((m) => m.id === msgId) || dmMessages.find((m) => m.id === msgId);
      if (msg?.dm) {
        adminAction("delete-dm", inLiveMode ? `${channelId}_live` : channelId, { dm_id: msgId });
        setDmMessages((prev) => prev.filter((m) => m.id !== msgId));
      } else {
        adminAction("delete-message", inLiveMode ? `${channelId}_live` : channelId, { message_id: msgId });
      }
    } else if (hasReplies) {
      // Non-admin with replies: soft delete
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, text: t("deletedMessage"), image: null, deleted: true } as Message : m))
      );
      setGalleryItems((prev) => prev.filter((item) => item.id !== msgId));
      deleteMessage({ uid, message_id: msgId, channel_id: inLiveMode ? `${channelId}_live` : channelId, soft: true });
    } else {
      // Non-admin no replies: hard delete
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      setGalleryItems((prev) => prev.filter((item) => item.id !== msgId));
      deleteMessage({ uid, message_id: msgId, channel_id: inLiveMode ? `${channelId}_live` : channelId, soft: false });
    }
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newPhotos: typeof pendingPhotos = [];
    for (const file of Array.from(files)) {
      if (file.type === "image/gif") {
        const previewUrl = URL.createObjectURL(file);
        const dims = await getImageDimensions(file);
        newPhotos.push({ blob: file, previewUrl, width: dims.width, height: dims.height });
      } else {
        const { blob, width, height } = await compressImage(file, 1200, 0.8);
        const previewUrl = URL.createObjectURL(blob);
        newPhotos.push({ blob, previewUrl, width, height });
      }
    }
    setPendingPhotos((prev) => [...prev, ...newPhotos]);
    // Reset input
    e.target.value = "";
    textareaRef.current?.focus();
  };

  const removePendingPhoto = (idx: number) => {
    setPendingPhotos((prev) => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[idx].previewUrl);
      updated.splice(idx, 1);
      return updated;
    });
  };

  const handleMemoizedReaction = useCallback((messageId: string, emoji: string) => {
    handleReactionRef.current(messageId, emoji);
  }, []);
  const handleMemoizedEmojiPicker = useCallback((messageId: string, rect: DOMRect) => {
    setEmojiPicker({ msgId: messageId, rect });
  }, []);
  useEffect(() => {
    handleReactionRef.current = handleReaction;
    handleLongPressRef.current = handleBubbleLongPress;
    handleTouchStartRef.current = handleTouchStart;
    handleTouchEndRef.current = handleTouchEnd;
  });
  const handleMemoizedLongPress = useCallback((message: Message, isSent: boolean, element: HTMLElement) => {
    handleLongPressRef.current(message, isSent, element);
  }, []);
  const handleMemoizedTouchStart = useCallback((message: Message, isSent: boolean, element: HTMLElement) => {
    handleTouchStartRef.current(message, isSent, element);
  }, []);
  const handleMemoizedTouchEnd = useCallback(() => {
    handleTouchEndRef.current();
  }, []);
  const handleOpenMessageImage = useCallback((message: Message) => {
    if (!message.image) return;
    setFullViewImage({ src: message.image, caption: message.text || undefined, date: message.created_at, msgId: message.id });
  }, []);

  // Passcode gate — show overlay if channel requires passcode
  if (passcodeGate && !isOwner) {
    return (
      <PasscodeOverlay
        channelId={channelId}
        channelName={passcodeGate.name}
        profileImage={passcodeGate.profile_image}
        bubbleColor={passcodeGate.bubble_color || "#3b8df0"}
        passcodeHint={passcodeGate.passcodeHint}
        notice={passcodeGate.notice}
        onSuccess={() => {
          // A passcode unlock always enters the normal channel first. Live
          // availability is synchronized by applyInitData and the user can
          // explicitly enter live mode from its join banner.
          setInLiveMode(false);
          localStorage.setItem(`inLiveMode_${channelId}`, "false");
          setLoading(true);
          setPasscodeGate(null);
          const requestId = ++initRequestIdRef.current;
          fetchInit(channelId).then((data: InitData) => {
            if (requestId !== initRequestIdRef.current) return;
            applyInitData(data);
            setLoading(false);
          }).catch(() => {
            if (requestId !== initRequestIdRef.current) return;
            // Restore the gate instead of leaving the page stuck on loading
            // when the authenticated init request fails.
            setPasscodeGate(passcodeGate);
            setLoading(false);
          });
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
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
        <div className="flex-1 overflow-hidden"><SkeletonLoading /></div>
      </div>
    );
  }

  const hasChannelRules = Boolean(channel?.notice && channel.notice !== "[]");
  const handleShareChannel = async () => {
    const url = `${window.location.origin}/ch/${encodeURIComponent(channelId)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: channel?.name || channelId, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setBanner({ text: t("channelLinkCopied"), color: bubbleColor });
      setTimeout(() => setBanner(null), 2500);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        setBanner({ text: t("channelLinkCopied"), color: bubbleColor });
      } catch {
        setBanner({ text: t("channelShareFailed"), color: "#d32f2f" });
      }
      setTimeout(() => setBanner(null), 2500);
    }
  };

  return (
    <div className="h-dvh flex flex-col relative" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      {/* Header */}
      <header
        className="flex-none flex items-center px-4 relative"
        style={{
          background: "var(--header-bg)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderBottom: "0.5px solid var(--hairline)",
          padding: "10px 16px",
          zIndex: 5,
          cursor: "pointer",
        }}
        onClick={(e) => {
          // Scroll to top unless clicking a button/link
          if ((e.target as HTMLElement).closest("button, a")) return;
          messagesContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        }}
      >
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 p-0 border-none bg-transparent cursor-pointer flex items-center"
          style={{ color: bubbleColor }}
          onClick={() => { window.location.href = "/dashboard"; }}
          aria-label={t("dashboardChats")}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 6px)", height: "calc(var(--bubble-font-size) + 6px)" }}>
            <path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {hasChannelRules && (
          <button
            type="button"
            className="absolute left-[50px] top-1/2 -translate-y-1/2 p-0 border-none bg-transparent cursor-pointer flex items-center"
            style={{ color: bubbleColor }}
            onClick={() => setShowNotice(true)}
            aria-label={t("rules")}
          >
            <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 2px)", height: "calc(var(--bubble-font-size) + 2px)" }}>
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="12" cy="8" r="1.15" fill="currentColor" />
              <path d="M12 11v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}

        <div className="flex-1 flex flex-col items-center gap-[6px]">
          <button
            type="button"
            disabled={ownerChannelCount <= 1}
            className="rounded-full overflow-hidden relative top-[3px] border-none p-0"
            aria-label={t("dashboardOwnerChannels")}
            style={{ width: "calc(var(--bubble-font-size) + 24px)", height: "calc(var(--bubble-font-size) + 24px)", cursor: ownerChannelCount > 1 ? "pointer" : "default" }}
            onClick={() => { if (ownerChannelCount > 1) setShowOwnerChannels(true); }}
          >
            {channel?.profile_image ? (
              <img src={channel.profile_image} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-lg" style={{ background: "var(--gray-bubble)" }}>💬</div>
            )}
          </button>
          <div className="font-normal flex items-center gap-[2px]" style={{ fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--gray-text)" }}>
            {channel?.name}
          </div>
        </div>

        <button
          type="button"
          className="absolute right-[88px] top-1/2 -translate-y-1/2 p-0 border-none bg-transparent cursor-pointer flex items-center"
          style={{ color: bubbleColor }}
          onClick={handleShareChannel}
          aria-label={t("shareChannel")}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 3px)", height: "calc(var(--bubble-font-size) + 3px)" }}>
            <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 11v8h12v-8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button
          className="absolute right-[52px] top-1/2 -translate-y-1/2 p-0 border-none bg-transparent cursor-pointer flex items-center"
          style={{ color: bubbleColor }}
          onClick={() => setShowSearch(!showSearch)}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 3px)", height: "calc(var(--bubble-font-size) + 3px)" }}>
            <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.35-4.35" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 p-0 border-none bg-transparent cursor-pointer flex items-center"
          style={{ color: bubbleColor }}
          onClick={(e) => setHeaderMenu(e.currentTarget.getBoundingClientRect())}
        >
          <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 5px)", height: "calc(var(--bubble-font-size) + 5px)" }}>
            <circle cx="12" cy="5" r="1.8" fill="currentColor" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" />
            <circle cx="12" cy="19" r="1.8" fill="currentColor" />
          </svg>
        </button>
      </header>

      {/* Search bar */}
      {showSearch && (
        <SearchBar
          channelId={channelId}
          messages={effectiveAdmin ? [...messages, ...dmMessages] : messages}
          onNavigate={(msgId) => {
            const el = document.getElementById(`msg-${msgId}`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          onSearchState={setSearchState}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* Admin return banner */}
      {isAdmin && adminViewAsUser && (
        <div
          className="flex-none flex items-center justify-between"
          style={{
            padding: "6px 14px",
            background: `color-mix(in srgb, ${bubbleColor} 10%, transparent)`,
            borderBottom: `1px solid color-mix(in srgb, ${bubbleColor} 20%, transparent)`,
            fontSize: "calc(var(--bubble-font-size) - 5px)",
            color: bubbleColor,
          }}
        >
          <span>{t("viewingAsUser")}</span>
          <button
            className="border-none rounded-lg cursor-pointer"
            style={{
              background: bubbleColor,
              color: "#fff",
              padding: "4px 10px",
              fontSize: "calc(var(--bubble-font-size) - 5px)",
              fontWeight: 500,
            }}
            onClick={() => setAdminViewAsUser(false)}
          >
            {t("returnToAdmin")}
          </button>
        </div>
      )}

      {/* Live banners */}
      {liveActive && !inLiveMode && (
        <LiveJoinBanner title={liveTitle} onJoin={() => { setInLiveMode(true); localStorage.setItem(`inLiveMode_${channelId}`, "true"); localStorage.removeItem(`noticeDismissed_${channelId}_live`); setMessages([]); setDmMessages([]); setActiveNotice(""); fetchInit(`${channelId}_live`).then((data) => { setMessages(data.messages); if (data.dm) setDmMessages(data.dm.map((d: any) => ({ ...d, dm: true }))); if (data.bannerNotice) setActiveNotice(data.bannerNotice); if (data.channel) setChannel((prev) => prev ? { ...prev, is_frozen: data.channel.is_frozen ?? 0 } : prev); }).catch(() => {}); }} />
      )}
      {inLiveMode && (
        <LiveExitBanner
          isAdmin={effectiveAdmin}
          title={liveTitle}
          viewerCount={liveCount}
          onExit={() => {
            if (effectiveAdmin) {
              setShowEndLiveConfirm(true);
            } else {
              // Non-admin just leaves live mode (live continues for others)
              setInLiveMode(false);
              localStorage.setItem(`inLiveMode_${channelId}`, "false");
              // Refetch normal channel state (messages, notice, freeze)
              fetchInit(channelId).then((data) => {
                setChannel(data.channel);
                setMessages(data.messages);
                setActiveNotice(data.bannerNotice || "");
              });
            }
          }}
        />
      )}

      {/* Notice Banner */}
      {activeNotice && (
        <NoticeBanner
          channelId={inLiveMode ? `${channelId}_live` : channelId}
          notice={activeNotice}
          onDismiss={() => setActiveNotice("")}
        />
      )}

      {/* Offline banner */}
      {!connected && !loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "6px 12px", background: "#fff3e0", borderBottom: "0.5px solid #ffe0b2", flexShrink: 0, fontSize: "calc(var(--bubble-font-size) - 4px)", color: "#e65100", lineHeight: 1 }}>
          <span>{t("connectionLost")}</span>
        </div>
      )}

      {/* Live viewer count — overlays top-right of messages area */}
      {inLiveMode && (
        <div style={{ position: "absolute", top: activeNotice ? "200px" : "148px", right: "14px", zIndex: 10, display: "inline-flex", alignItems: "center", gap: "0.28em", padding: "0.28em 0.58em", borderRadius: "999px", background: "rgba(60,60,67,.10)", color: "rgba(60,60,67,.68)", fontSize: "var(--bubble-font-size, 13px)", fontWeight: 600, lineHeight: 1, pointerEvents: "none", transition: "top .2s ease" }}>
          <svg viewBox="0 0 24 24" style={{ width: "1.05em", height: "1.05em" }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="3.25" /><path d="M5.75 19c.45-4 2.55-6 6.25-6s5.8 2 6.25 6" />
          </svg>
          <span>{liveCount}</span>
        </div>
      )}

      {/* Messages */}
      <main
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="messages-scroll flex-1 overflow-y-auto overflow-x-hidden flex flex-col"
        style={{ position: "relative", padding: "12px 14px 8px", WebkitOverflowScrolling: "touch" }}
      >
        <MessageList
          threadedMessages={threadedMessages}
          effectiveAdmin={effectiveAdmin}
          uid={uid}
          authUserId={authUserId}
          bubbleColor={bubbleColor}
          reportedMsgIds={reportedMsgIds}
          reportedTargetIds={reportedTargetIds}
          blockedUidSet={blockedUidSet}
          searchQuery={searchState.query}
          searchResultIdSet={searchResultIdSet}
          activeSearchId={searchState.activeId}
          deletedMessageLabel={t("deletedMessage")}
          onLongPress={handleMemoizedLongPress}
          onTouchStart={handleMemoizedTouchStart}
          onTouchEnd={handleMemoizedTouchEnd}
          onOpenImage={handleOpenMessageImage}
          onExpand={openExpandedPost}
          onReaction={handleMemoizedReaction}
          onEmojiPicker={handleMemoizedEmojiPicker}
        />
        <div ref={messagesEndRef} />
      </main>

      {/* Long-message reader, constrained to the visible chat field. */}
      {expandedPost && (
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
          onClick={() => setExpandedPost(null)}
        >
          <div
            style={{ background: "var(--bg)", borderRadius: "18px", maxWidth: "400px", width: "100%", maxHeight: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "12px 16px", borderBottom: "1px solid var(--hairline)" }}>
              <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", fontSize: "18px", lineHeight: 1 }} onClick={() => setExpandedPost(null)}>✕</button>
            </div>
            <div style={{ padding: "16px", fontSize: "var(--bubble-font-size)", lineHeight: 1.6, color: "var(--gray-text)", overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {expandedPost.text}
            </div>
          </div>
        </div>
      )}

      {/* Scroll to bottom */}
      <ScrollToBottom visible={showScrollBtn} onClick={scrollToBottom} />

      {/* Toast banner */}
      {banner && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[60] text-white font-normal px-4 py-[10px] rounded-[12px] text-center max-w-[90%]"
          style={{
            bottom: "80px",
            background: banner.color.startsWith("var(") ? banner.color : `${banner.color}dd`,
            backdropFilter: "saturate(180%) blur(12px)",
            WebkitBackdropFilter: "saturate(180%) blur(12px)",
            fontSize: "var(--bubble-font-size)",
            boxShadow: "0 6px 20px rgba(0,0,0,.25)",
          }}
        >
          {banner.text}
        </div>
      )}

      {/* Reply bar */}
      <ReplyBar replyingTo={replyingTo} onClose={() => setReplyingTo(null)} />

      {/* Photo preview */}
      {pendingPhotos.length > 0 && (
        <div
          className="flex-none flex items-center gap-2"
          style={{
            padding: "8px 16px",
            background: "var(--composer-bg)",
            borderTop: "0.5px solid var(--hairline)",
          }}
        >
          <div className="flex gap-2 overflow-x-auto flex-1">
            {pendingPhotos.map((p, i) => (
              <div key={i} className="relative flex-shrink-0">
                <img
                  src={p.previewUrl}
                  className="block rounded-[10px]"
                  style={{ width: "56px", height: "56px", objectFit: "cover" }}
                />
                <button
                  className="absolute flex items-center justify-center border-none cursor-pointer"
                  style={{
                    top: "-4px",
                    right: "-4px",
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    background: "rgba(0,0,0,.6)",
                    color: "#fff",
                    fontSize: "11px",
                    lineHeight: 1,
                  }}
                  onClick={() => removePendingPhoto(i)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Frozen banner */}

      {/* Composer */}
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
          {/* Hidden photo input */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={handlePhotoSelect}
          />

          <button
            className="flex-none border-none bg-transparent p-0 flex items-center justify-center cursor-pointer self-center"
            style={{ color: "var(--meta)", width: "32px", height: "32px", opacity: (isUserBlocked && (hasPetitioned || !petitionEnabled)) ? 0.3 : 1, pointerEvents: (isUserBlocked && (hasPetitioned || !petitionEnabled)) ? "none" : "auto" }}
            onClick={(e) => setPlusMenu(e.currentTarget.getBoundingClientRect())}
          >
            <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 11px)", height: "calc(var(--bubble-font-size) + 11px)" }}>
              <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 7v10M7 12h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>

          <div
            className="flex-1 flex items-center relative"
            style={{
              minHeight: "calc(var(--bubble-font-size) + 19px)",
              padding: "0 6px 0 calc(var(--bubble-font-size) * 0.824)",
              background: (channel?.is_frozen && !effectiveAdmin && !dmMode)
                ? "rgba(0,0,0,.03)"
                : isUserBlocked
                  ? "rgba(255,59,48,.05)"
                  : dmMode ? "rgba(155,89,182,.05)" : "var(--input-bg)",
              border: (channel?.is_frozen && !effectiveAdmin && !dmMode)
                ? "1px solid #ccc"
                : isUserBlocked
                  ? "1px solid #d32f2f"
                  : dmMode ? "1px solid #7b3fa0" : "1px solid var(--input-border)",
              borderRadius: "20px",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={!!(channel?.is_frozen && !effectiveAdmin && !dmMode) || (isUserBlocked && (hasPetitioned || !petitionEnabled))}
              rows={1}
              placeholder={
                (channel?.is_frozen && !effectiveAdmin && !dmMode)
                  ? t("frozenInput")
                  : isUserBlocked
                    ? (hasPetitioned || !petitionEnabled ? t("blockedInput") : t("petitionInput"))
                    : (channel?.is_frozen && effectiveAdmin)
                      ? t("frozenInput")
                      : dmMode
                        ? t("sentToAdmin")
                        : t("messageInput")
              }
              className="flex-1 border-none bg-transparent outline-none resize-none"
              style={{
                fontSize: "var(--bubble-font-size)",
                color: (channel?.is_frozen && !effectiveAdmin && !dmMode) ? "#999" : "var(--gray-text)",
                padding: "8px 0",
                caretColor: "var(--tint)",
                fontFamily: "inherit",
                lineHeight: 1.4,
                maxHeight: "80px",
                overflowY: "auto",
              }}
            />
            {/* Emoji bar trigger (live mode only) */}
            {inLiveMode && !isUserBlocked && (
              <EmojiBar channelId={channelId} presets={emojiPresets} onBroadcast={(emoji, x, h) => {
                send({ type: "emoji-fx", emoji, x, h });
              }} />
            )}
            {(input.trim() || pendingPhotos.length > 0) && !(channel?.is_frozen && !effectiveAdmin && !dmMode) && (
              <button
                onClick={handleSend}
                className="flex-none flex items-center justify-center border-none cursor-pointer"
                style={{
                  width: "calc(var(--bubble-font-size) + 9px)",
                  height: "calc(var(--bubble-font-size) + 9px)",
                  borderRadius: "50%",
                  background: dmMode ? "#7b3fa0" : bubbleColor,
                }}
              >
                <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) - 1px)", height: "calc(var(--bubble-font-size) - 1px)" }}>
                  <path d="M12 20V5m0 0l-6 6m6-6l6 6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </footer>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          msg={contextMenu.msg}
          isSent={contextMenu.isSent}
          anchorRect={contextMenu.rect}
          bubbleEl={contextMenu.bubbleEl}
          isAdmin={effectiveAdmin}
          onReaction={handleReaction}
          onReply={(msgId) => {
            // Reply to top-level parent, not to a reply
            const msg = messages.find((m) => m.id === msgId);
            if (msg?.reply_to) {
              const parent = messages.find((m) => m.id === msg.reply_to);
              if (parent) { setReplyingTo(parent); } else { setReplyingTo(msg); }
            } else if (msg) {
              setReplyingTo(msg);
            }
            textareaRef.current?.focus();
          }}
          onReport={!effectiveAdmin && !contextMenu.isOwn ? () => {
            const msgId = contextMenu.msg.id;
            const msgText = contextMenu.msg.text;
            setReportedMsgIds((prev) => {
              const next = new Set(prev);
              next.add(msgId);
              localStorage.setItem("reportedMsgIds", JSON.stringify([...next]));
              return next;
            });
            const preview = msgText.length > 50 ? msgText.slice(0, 50) + "…" : msgText;
            sendMessageApi({ uid, text: `${t("reportPrefix")}: "${preview}"`, channel_id: channelId, report: true, reported_msg_id: msgId } as any);
            setBanner({ text: t("report"), color: "#d32f2f" });
            setTimeout(() => setBanner(null), 3000);
          } : undefined}
          onUnreport={!effectiveAdmin && !contextMenu.isOwn ? () => {
            const msgId = contextMenu.msg.id;
            setReportedMsgIds((prev) => {
              const next = new Set(prev);
              next.delete(msgId);
              localStorage.setItem("reportedMsgIds", JSON.stringify([...next]));
              return next;
            });
            // Find and delete the report message from D1
            const reportMsg = messages.find((m) => m.report && m.reported_msg_id === msgId && m.uid === uid);
            if (reportMsg) {
              deleteMessage({ uid, message_id: reportMsg.id, channel_id: inLiveMode ? `${channelId}_live` : channelId, soft: false });
              setMessages((prev) => prev.filter((m) => m.id !== reportMsg.id));
            }
            setBanner({ text: t("unreport"), color: "var(--meta)" });
            setTimeout(() => setBanner(null), 3000);
          } : undefined}
          isReported={reportedMsgIds.has(contextMenu.msg.id)}
          onDelete={contextMenu.isOwn ? handleDelete : undefined}
          onDeleteWithReplies={effectiveAdmin && !contextMenu.isOwn ? (msgId) => {
            const targetMsg = messages.find((m) => m.id === msgId);
            const idsToDelete = new Set([msgId]);

            // If deleting a report message, also delete the reported message + its replies
            if (targetMsg?.report && targetMsg.reported_msg_id) {
              idsToDelete.add(targetMsg.reported_msg_id);
              messages.forEach((m) => { if (m.reply_to === targetMsg.reported_msg_id) idsToDelete.add(m.id); });
            }

            // Also delete replies of the target message
            messages.forEach((m) => { if (m.reply_to === msgId) idsToDelete.add(m.id); });

            setMessages((prev) => prev.filter((m) => !idsToDelete.has(m.id)));
            // Delete via admin endpoint
            idsToDelete.forEach((id) => {
              const msg = messages.find((m) => m.id === id) || dmMessages.find((m) => m.id === id);
              if (msg?.dm) adminAction("delete-dm", inLiveMode ? `${channelId}_live` : channelId, { dm_id: id });
              else adminAction("delete-message", inLiveMode ? `${channelId}_live` : channelId, { message_id: id });
            });
            setDmMessages((prev) => prev.filter((m) => !idsToDelete.has(m.id)));
            setBanner({ text: t("delete"), color: "#d32f2f" });
            setTimeout(() => setBanner(null), 3000);
          } : undefined}
          onEdit={contextMenu.isOwn ? (msgId) => {
            const msg = messages.find((m) => m.id === msgId);
            if (msg) setEditingMsg({ id: msg.id, text: msg.text });
          } : undefined}
          onBlock={effectiveAdmin && !contextMenu.isOwn ? (blockUid) => {
            const isBlocked = blockedUsers.some((b) => b.uid === blockUid);
            if (isBlocked) {
              adminAction("unblock", channelId, { uid: blockUid });
              setBlockedUsers((prev) => prev.filter((b) => b.uid !== blockUid));
              setBanner({ text: `${t("anon")}#${blockUid.slice(-4)} ${t("anonUnblocked")}`, color: "#2a9d4e" });
            } else {
              const msg = contextMenu.msg;
              adminAction("block", channelId, { uid: blockUid, reason: msg.text?.slice(0, 50) || "", fingerprint: "" });
              setBlockedUsers((prev) => [...prev, { uid: blockUid, reason: msg.text?.slice(0, 50) || "" }]);
              setBanner({ text: `${t("anon")}#${blockUid.slice(-4)} ${t("anonBlocked")}`, color: "#d32f2f" });
            }
            setTimeout(() => setBanner(null), 3000);
          } : undefined}
          isBlockedUser={blockedUsers.some((b) => b.uid === contextMenu.msg.uid)}
          onEmojiPicker={(msgId, rect) => setEmojiPicker({ msgId, rect })}
          onClose={() => setContextMenu(null)}
          isMyMessage={contextMenu.isOwn}
        />
      )}

      {/* Welcome Popup */}
      <WelcomePopup channelId={channelId} bubbleColor={bubbleColor} customConfig={welcomeConfig} />

      {showChannelDeleted && (
        <ConfirmDialog
          title={t("channelDeletedTitle")}
          message={t("channelDeletedMessage")}
          confirmLabel={t("goToDashboard")}
          onConfirm={() => {
            removeRecentChannel(channelId);
            window.location.href = "/dashboard";
          }}
          onCancel={() => {}}
          showCancel={false}
          closeOnBackdrop={false}
        />
      )}

      {/* Header Menu */}
      {headerMenu && (
        <HeaderMenu
          anchorRect={headerMenu}
          onSettings={() => setShowSettings(true)}
          onGallery={() => {
            setShowGallery(true);
            setGalleryItems([]);
            setGalleryHasMore(true);
            const fetchChannel = inLiveMode ? `${channelId}_live` : channelId;
            fetchGallery(fetchChannel).then((data) => {
              if (data.gallery) {
                setGalleryItems(data.gallery);
                if (data.gallery.length < 50) setGalleryHasMore(false);
              }
            });
          }}
          onLinks={() => setShowLinks(true)}
          onRules={channel?.notice && channel.notice !== "[]" ? () => setShowNotice(true) : undefined}
          onAdmin={effectiveAdmin ? () => setShowAdminPanel(true) : undefined}
          onClose={() => setHeaderMenu(null)}
        />
      )}

      {showOwnerChannels && (
        <OwnerChannelsPopup
          currentChannelId={channelId}
          bubbleColor={bubbleColor}
          onClose={() => setShowOwnerChannels(false)}
        />
      )}

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel
          channelId={channelId}
          currentColor={bubbleColor}
          onColorChange={(color) => {
            setLocalBubbleColor(color);
            updateRecentChannelAppearance(channelId, { bubbleColor: color });
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Gallery Panel */}
      {showGallery && (
        <GalleryPanel
          items={galleryItems}
          hasMore={galleryHasMore}
          onLoadMore={() => {
            if (galleryLoading.current || !galleryHasMore || galleryItems.length === 0) return;
            galleryLoading.current = true;
            const oldest = galleryItems[galleryItems.length - 1];
            const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
            fetchGallery(fetchChannel, oldest.created_at).then((data) => {
              if (data.gallery && data.gallery.length > 0) {
                setGalleryItems((prev) => [...prev, ...data.gallery]);
                if (data.gallery.length < 50) setGalleryHasMore(false);
              } else {
                setGalleryHasMore(false);
              }
            }).finally(() => { galleryLoading.current = false; });
          }}
          onViewImage={(src, meta) => {
            const msg = messages.find((m) => m.id === meta.id);
            setFullViewImage({ src, caption: msg?.text || undefined, date: meta.created_at, msgId: meta.id, fromGallery: true });
          }}
          onClose={() => setShowGallery(false)}
        />
      )}

      {/* Links Panel */}
      {showLinks && (
        <LinksPanel
          channelId={inLiveModeRef.current ? `${channelId}_live` : channelId}
          onNavigate={(msgId) => { setShowLinks(false); setTimeout(() => scrollToMessage(msgId), 100); }}
          onClose={() => setShowLinks(false)}
        />
      )}

      {/* Admin Panel */}
      {showAdminPanel && (
        <AdminPanel
          channelId={channelId}
          channelName={channel?.name || ""}
          profileImage={channel?.profile_image || null}
          currentColor={bubbleColor}
          passcodeHint={channel?.passcode_hint || ""}
          isFrozen={!!channel?.is_frozen}
          liveActive={liveActive}
          petitionEnabled={petitionEnabled}
          dmEnabled={dmEnabled}
          notice={channel?.notice || "[]"}
          welcomeConfig={welcomeConfig}
          blockedUsers={blockedUsers}
          onFreeze={() => {
            setChannel((prev) => prev ? { ...prev, is_frozen: 1 } : null);
            adminAction("freeze", inLiveMode ? `${channelId}_live` : channelId, { frozen: true });
            setBanner({ text: t("chatFrozen"), color: "#4a4d8f" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onUnfreeze={() => {
            setChannel((prev) => prev ? { ...prev, is_frozen: 0 } : null);
            adminAction("freeze", inLiveMode ? `${channelId}_live` : channelId, { frozen: false });
            setBanner({ text: t("chatUnfrozen"), color: bubbleColor });
            setTimeout(() => setBanner(null), 3000);
          }}
          onToggleView={() => setAdminViewAsUser(true)}
          onLive={() => {
            if (liveActive) {
              // End live
              setLiveActive(false);
              setInLiveMode(false);
              fetchInit(channelId).then((data) => { setMessages(data.messages); });
              setBanner({ text: t("liveEnded"), color: "#c0392b" });
              setTimeout(() => setBanner(null), 3000);
            } else {
              // Show title prompt
              setShowLiveTitlePrompt(true);
            }
          }}
          onPetitionToggle={() => {
            const newVal = !petitionEnabled;
            setPetitionEnabled(newVal);
            adminAction("set-petition", channelId, { enabled: newVal });
            setBanner({ text: newVal ? t("petitionAllowed") : t("petitionBlocked"), color: newVal ? "#2a9d4e" : "#c0392b" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onDmToggle={() => {
            const newVal = !dmEnabled;
            setDmEnabled(newVal);
            adminAction("set-dm", channelId, { enabled: newVal });
            setBanner({ text: newVal ? t("dmAllowed") : t("dmBlocked"), color: newVal ? "#2a9d4e" : "#c0392b" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onColorChange={(color) => {
            setLocalBubbleColor(color);
            setChannel((prev) => prev ? { ...prev, bubble_color: color } : null);
            updateRecentChannelAppearance(channelId, { bubbleColor: color });
            localStorage.setItem(`bubbleColor_${channelId}`, color);
            document.documentElement.style.setProperty("--bubble-sent", color);
            adminAction("update-profile", channelId, { bubble_color: color });
          }}
          onNameChange={(name) => {
            setChannel((prev) => prev ? { ...prev, name } : null);
            updateRecentChannelAppearance(channelId, { name });
            adminAction("update-profile", channelId, { name });
            setBanner({ text: t("nameChanged"), color: bubbleColor });
            setTimeout(() => setBanner(null), 3000);
          }}
          onProfileImageChange={(url) => {
            setChannel((prev) => prev ? { ...prev, profile_image: url } : null);
            updateRecentChannelAppearance(channelId, { profileImage: url });
            adminAction("update-profile", channelId, { profile_image: url });
            setBanner({ text: t("profileChanged"), color: bubbleColor });
            setTimeout(() => setBanner(null), 3000);
          }}
          onNoticeChange={(noticeStr) => {
            setChannel((prev) => prev ? { ...prev, notice: noticeStr } : null);
            adminAction("set-rules", channelId, { rules: noticeStr });
            setBanner({ text: t("rulesChanged"), color: bubbleColor });
            setTimeout(() => setBanner(null), 3000);
          }}
          onWelcomeChange={(config) => {
            setWelcomeConfig(config);
            localStorage.setItem(`welcomeConfig_${channelId}`, config);
            adminAction("set-welcome", channelId, { config });
            setBanner({ text: t("welcomeChanged"), color: bubbleColor });
            setTimeout(() => setBanner(null), 3000);
          }}
          onUnblock={(blockUid) => {
            adminAction("unblock", channelId, { uid: blockUid });
            setBlockedUsers((prev) => prev.filter((b) => b.uid !== blockUid));
            setBanner({ text: t("chatUnfrozen"), color: "#2a9d4e" });
            setTimeout(() => setBanner(null), 3000);
          }}
          onClose={() => setShowAdminPanel(false)}
        />
      )}

      {/* Emoji Picker */}
      {emojiPicker && (
        <EmojiPicker
          anchorRect={emojiPicker.rect}
          onSelect={(emoji) => {
            handleReaction(emojiPicker.msgId, emoji);
            setEmojiPicker(null);
          }}
          onClose={() => setEmojiPicker(null)}
        />
      )}

      {/* Plus Menu */}
      {plusMenu && (
        <PlusMenu
          anchorRect={plusMenu}
          dmMode={dmMode}
          dmEnabled={dmEnabled}
          isAdmin={effectiveAdmin}
          inLiveMode={inLiveMode}
          onPhoto={() => photoInputRef.current?.click()}
          onDmToggle={() => setDmMode(!dmMode)}
          onNotice={effectiveAdmin ? () => setShowNoticeEdit(true) : undefined}
          onEmojiPreset={() => setShowEmojiPreset(true)}
          onClose={() => setPlusMenu(null)}
        />
      )}

      {/* Edit Dialog */}
      {editingMsg && (
        <EditDialog
          currentText={editingMsg.text}
          onSave={(newText) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === editingMsg.id ? { ...m, text: newText, edited: true } as Message : m))
            );
            editMessageApi({ uid: effectiveAdmin && authUserId ? authUserId : uid, message_id: editingMsg.id, channel_id: inLiveMode ? `${channelId}_live` : channelId, text: newText });
          }}
          onClose={() => setEditingMsg(null)}
        />
      )}

      {/* Live Title Prompt */}
      {showLiveTitlePrompt && (
        <LiveTitlePrompt
          onStart={async (title) => {
            setShowLiveTitlePrompt(false);
            setLiveTitle(title);
            setLiveActive(true);
            setInLiveMode(true);
            setMessages([]);
            setDmMessages([]);
            setActiveNotice("");
            localStorage.setItem(`liveActive_${channelId}`, "true");
            localStorage.setItem(`inLiveMode_${channelId}`, "true");
            localStorage.removeItem(`noticeDismissed_${channelId}_live`);
            localStorage.setItem(`liveTitle_${channelId}`, title);
            setBanner({ text: t("liveStarted"), color: "#c0392b" });
            setTimeout(() => setBanner(null), 3000);
            const res = await adminAction("start-live", channelId, { title }) as any;
            if (res?.sessionId) {
              setLiveSessionId(res.sessionId);
              localStorage.setItem(`liveSession_${channelId}`, res.sessionId);
            }
          }}
          onCancel={() => setShowLiveTitlePrompt(false)}
        />
      )}

      {/* End Live Confirm */}
      {showEndLiveConfirm && (
        <ConfirmDialog
          title={t("liveEndTitle")}
          message={t("liveEndMessage")}
          confirmLabel={t("liveEndBtn")}
          confirmColor="#c0392b"
          onConfirm={async () => {
            setShowEndLiveConfirm(false);
            setLiveActive(false);
            setInLiveMode(false);
            localStorage.setItem(`liveActive_${channelId}`, "false");
            localStorage.setItem(`inLiveMode_${channelId}`, "false");
            localStorage.removeItem(`liveSeen_${channelId}`);
            localStorage.removeItem(`liveTitle_${channelId}`);
            localStorage.removeItem(`liveSession_${channelId}`);
            await adminAction("end-live", channelId);
            fetchInit(channelId).then((data) => {
              setChannel(data.channel);
              setMessages(data.messages);
              setDmMessages(data.dm ? data.dm.map((d: any) => ({ ...d, dm: true })) : []);
              setActiveNotice(data.bannerNotice || "");
            });
            setShowLiveEnded(true);
          }}
          onCancel={() => setShowEndLiveConfirm(false)}
        />
      )}

      {/* Live Ended Popup (shown to non-admin when kicked from live) */}
      {showLiveEnded && (
        <LiveEndedPopup onClose={() => {
          setShowLiveEnded(false);
          fetchInit(channelId).then((data) => { setMessages(data.messages); });
        }} />
      )}

      {/* Live Started Popup (shown to non-admin when live starts) */}
      {showLivePopup && (
        <LivePopup
          title={liveTitle}
          onJoin={() => {
            setShowLivePopup(false);
            setInLiveMode(true);
            localStorage.setItem(`inLiveMode_${channelId}`, "true");
            localStorage.setItem(`liveSeen_${channelId}`, liveSessionId);
            localStorage.removeItem(`noticeDismissed_${channelId}_live`);
            setMessages([]);
            setDmMessages([]);
            setActiveNotice("");
            fetchInit(`${channelId}_live`).then((data) => { setMessages(data.messages); if (data.dm) setDmMessages(data.dm.map((d: any) => ({ ...d, dm: true }))); if (data.bannerNotice) setActiveNotice(data.bannerNotice); if (data.channel) setChannel((prev) => prev ? { ...prev, is_frozen: data.channel.is_frozen ?? 0 } : prev); }).catch(() => {});
          }}
          onDismiss={() => {
            setShowLivePopup(false);
            // Mark as seen so banner shows instead of popup next time
            localStorage.setItem(`liveSeen_${channelId}`, liveSessionId);
          }}
        />
      )}

      {/* Emoji Preset Panel */}
      {showEmojiPreset && (
        <EmojiPresetPanel
          channelId={channelId}
          onClose={() => setShowEmojiPreset(false)}
        />
      )}

      {/* Notice Edit Dialog */}
      {showNoticeEdit && (
        <NoticeEditDialog
          currentTitle={(() => { try { const p = JSON.parse(activeNotice); return p.title || activeNotice; } catch { return activeNotice; } })()}
          currentBody={(() => { try { const p = JSON.parse(activeNotice); return p.body || ""; } catch { return ""; } })()}
          onSave={(title, body) => {
            if (!title) {
              setActiveNotice("");
              localStorage.removeItem(`activeNotice_${channelId}`);
              adminAction("set-notice", inLiveMode ? `${channelId}_live` : channelId, { text: "" });
              setBanner({ text: t("noticePosted"), color: "var(--meta)" });
            } else {
              const notice = body ? JSON.stringify({ title, body }) : title;
              setActiveNotice(notice);
              localStorage.setItem(`activeNotice_${channelId}`, notice);
              localStorage.removeItem(`noticeDismissed_${channelId}`);
              adminAction("set-notice", inLiveMode ? `${channelId}_live` : channelId, { text: notice });
              setBanner({ text: t("noticePosted"), color: bubbleColor });
            }
            setTimeout(() => setBanner(null), 3000);
          }}
          onClose={() => setShowNoticeEdit(false)}
        />
      )}

      {/* Notice Panel */}
      {showNotice && (
        <NoticePanel
          notice={(() => { try { return JSON.parse(channel?.notice || "[]"); } catch { return []; } })()}
          onClose={() => setShowNotice(false)}
        />
      )}

      {/* Full view image overlay */}
      {fullViewImage && (
        <div
          className="fixed inset-0 z-[120] flex flex-col items-center justify-center cursor-pointer animate-[ctxFade_0.2s_ease]"
          style={{ background: "rgba(0,0,0,.85)" }}
          onClick={() => setFullViewImage(null)}
        >
          <img
            src={fullViewImage.src}
            alt=""
            style={{ maxWidth: "90%", maxHeight: "70%", objectFit: "contain", borderRadius: "8px" }}
          />
          {(fullViewImage.caption || fullViewImage.date) && (
            <div style={{ textAlign: "center", padding: "12px" }} onClick={(e) => e.stopPropagation()}>
              {fullViewImage.caption && (
                <div style={{ color: "#fff", fontSize: "var(--bubble-font-size, 15px)", marginBottom: "8px", textShadow: "0 1px 4px rgba(0,0,0,.5)" }}>
                  {fullViewImage.caption}
                </div>
              )}
              {fullViewImage.date && fullViewImage.msgId && fullViewImage.fromGallery && (
                <button
                  onClick={() => {
                    const msgId = fullViewImage.msgId!;
                    setFullViewImage(null);
                    setShowGallery(false);
                    setTimeout(() => scrollToMessage(msgId), 100);
                  }}
                  style={{ background: "rgba(255,255,255,.2)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,.3)", color: "#fff", fontSize: "calc(var(--bubble-font-size) - 2px)", padding: "6px 14px", borderRadius: "20px", cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}
                >
                  {(() => { const d = new Date(fullViewImage.date!); return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`; })()} →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
