"use client";

import React, { useCallback, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { MediaLoadingDots } from "./MediaLoadingDots";
import { MessageEmbeds } from "./MessageEmbeds";
import { highlightText } from "./SearchBar";

interface MessageImageProps {
  src: string;
  onOpen: () => void;
}

interface MessageTextProps {
  text: string;
  image: boolean;
  isMine: boolean;
  searchQuery: string;
  isSearchMatch: boolean;
  isActiveMatch: boolean;
  hiddenEmbedUrls: Set<string>;
  editedLabel?: string;
  onExpand: (text: string) => void;
}

interface MessageTextWithEmbedsProps {
  text: string;
  image: boolean;
  isMine: boolean;
  searchQuery: string;
  isSearchMatch: boolean;
  isActiveMatch: boolean;
  showEmbeds: boolean;
  fillWidgetWidth: boolean;
  editedLabel?: string;
  onExpand: (text: string) => void;
}

const URL_LINK_REGEX = /(https?:\/\/[^\s<]+|(?:www\.|(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|dev|app|co|me|tv|gg|xyz|kr|jp))(?:\/[^\s<]*)?)/g;

function linkifyText(text: string, isMine: boolean, hiddenEmbedUrls: Set<string>): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = [];
  let lastIndex = 0;
  const linkColor = isMine ? "rgba(255,255,255,0.9)" : "var(--bubble-sent)";

  for (const match of text.matchAll(URL_LINK_REGEX)) {
    const url = match[0];
    const index = match.index!;
    const fullUrl = url.startsWith("http") ? url : `https://${url}`;
    const isEmbedded = hiddenEmbedUrls.has(url) || hiddenEmbedUrls.has(fullUrl);

    if (index > lastIndex) {
      const before = text.slice(lastIndex, index);
      parts.push(isEmbedded ? before.replace(/\s+$/, "") : before);
    }

    if (!isEmbedded) {
      parts.push(
        <a
          key={`link-${index}`}
          href={fullUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: linkColor, textDecoration: "underline", textUnderlineOffset: "2px" }}
          onClick={(event) => event.stopPropagation()}
        >
          {url}
        </a>,
      );
    }

    lastIndex = index + url.length;
    if (isEmbedded && lastIndex < text.length) {
      const after = text.slice(lastIndex);
      const trimmed = after.replace(/^\s+/, "");
      lastIndex += after.length - trimmed.length;
    }
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  if (parts.every((part) => typeof part === "string" && !part.trim())) return [];
  return parts;
}

export function MessageImage({ src, onOpen }: MessageImageProps) {
  const { t } = useLocale();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  return (
    <div className="relative inline-block select-none" onContextMenu={(event) => event.preventDefault()}>
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
          draggable={false}
          className="block h-auto rounded-[15px] select-none"
          style={{ display: loaded ? "block" : "none", width: "auto", maxWidth: "100%", objectFit: "contain", userSelect: "none" }}
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

function MessageText({
  text,
  image,
  isMine,
  searchQuery,
  isSearchMatch,
  isActiveMatch,
  hiddenEmbedUrls,
  editedLabel,
  onExpand,
}: MessageTextProps) {
  const isLong = text.length > 1000;
  const displayText = isLong ? `${text.slice(0, 1000)}…` : text;
  const hasEmbeddedWidgets = hiddenEmbedUrls.size > 0;
  const parts = linkifyText(displayText, isMine, hiddenEmbedUrls);
  if (parts.length === 0 && hiddenEmbedUrls.size > 0) return null;

  const content = searchQuery && isSearchMatch
    ? highlightText(displayText, searchQuery, isActiveMatch)
    : parts;

  return (
    <span
      className="message-text"
      style={image
        ? { display: "block", padding: "2px 10px 8px" }
        : hasEmbeddedWidgets
          ? { display: "block", padding: "0 0 8px" }
          : undefined}
    >
      {content}
      {editedLabel && (
        <span style={{ fontSize: "calc(var(--bubble-font-size) - 6px)", opacity: 0.6, fontStyle: "italic", marginLeft: "4px" }}>
          {editedLabel}
        </span>
      )}
      {isLong && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onExpand(text);
          }}
          style={{ display: "block", background: "none", border: "none", color: isMine ? "rgba(255,255,255,0.85)" : "var(--bubble-sent, #3b8df0)", cursor: "pointer", padding: "4px 0 0", fontSize: "var(--bubble-font-size)", fontFamily: "inherit", marginLeft: "auto", transform: "rotate(-90deg)", lineHeight: 1 }}
        >
          <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 13l5 5 5-5" /><path d="M7 6l5 5 5-5" /></svg>
        </button>
      )}
    </span>
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
  fillWidgetWidth,
  editedLabel,
  onExpand,
}: MessageTextWithEmbedsProps) {
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
        editedLabel={editedLabel}
        onExpand={onExpand}
      />
      {showEmbeds && (
        <MessageEmbeds
          text={text}
          isMine={isMine}
          fillWidth={fillWidgetWidth}
          onEmbedReady={handleEmbedReady}
        />
      )}
    </>
  );
}

export const MemoizedMessageTextWithEmbeds = React.memo(MessageTextWithEmbeds);
