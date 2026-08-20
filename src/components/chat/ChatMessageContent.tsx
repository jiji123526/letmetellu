"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { MediaLoadingDots } from "./MediaLoadingDots";
import { MessageEmbeds } from "./MessageEmbeds";
import { highlightText } from "./search-highlight";

interface MessageImageProps {
  src: string;
  width?: number | null;
  height?: number | null;
  eager?: boolean;
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
const READY_MESSAGE_IMAGE_LIMIT = 500;
const readyMessageImages = new Set<string>();
const messageImageObserverGroups = new WeakMap<HTMLElement, {
  observer: IntersectionObserver;
  callbacks: Map<Element, () => void>;
}>();

function getMessageImageRootMargin(): string {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (connection?.saveData === true || connection?.effectiveType?.includes("2g")) {
    return "240px 0px";
  }
  if (connection?.effectiveType === "3g") return "720px 0px";
  return "1440px 0px";
}

function rememberReadyMessageImage(src: string): void {
  readyMessageImages.delete(src);
  readyMessageImages.add(src);
  while (readyMessageImages.size > READY_MESSAGE_IMAGE_LIMIT) {
    const oldest = readyMessageImages.values().next().value;
    if (typeof oldest !== "string") break;
    readyMessageImages.delete(oldest);
  }
}

function observeMessageImage(
  root: HTMLElement,
  target: HTMLElement,
  activate: () => void,
): () => void {
  let group = messageImageObserverGroups.get(root);
  if (!group) {
    const callbacks = new Map<Element, () => void>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        callbacks.get(entry.target)?.();
        callbacks.delete(entry.target);
        observer.unobserve(entry.target);
      });
      if (callbacks.size === 0) {
        observer.disconnect();
        messageImageObserverGroups.delete(root);
      }
    }, {
      root,
      rootMargin: getMessageImageRootMargin(),
    });
    group = { observer, callbacks };
    messageImageObserverGroups.set(root, group);
  }
  group.callbacks.set(target, activate);
  group.observer.observe(target);

  return () => {
    const current = messageImageObserverGroups.get(root);
    if (!current) return;
    current.observer.unobserve(target);
    current.callbacks.delete(target);
    if (current.callbacks.size === 0) {
      current.observer.disconnect();
      messageImageObserverGroups.delete(root);
    }
  };
}

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

function highlightRenderedPart(part: React.ReactNode, query: string, isActive: boolean): React.ReactNode {
  if (typeof part === "string") {
    return highlightText(part, query, isActive);
  }

  if (!React.isValidElement(part)) return part;

  const element = part as React.ReactElement<{ children?: React.ReactNode }>;
  if (element.props.children === undefined) return element;

  return React.cloneElement(element, {
    children: React.Children.map(element.props.children, (child) =>
      highlightRenderedPart(child, query, isActive)),
  });
}

function highlightRenderedText(
  parts: (string | React.ReactElement)[],
  query: string,
  isActive: boolean,
): React.ReactNode[] {
  return parts.map((part, index) => (
    <React.Fragment key={`search-part-${index}`}>
      {highlightRenderedPart(part, query, isActive)}
    </React.Fragment>
  ));
}

export function MessageImage({
  src,
  width,
  height,
  eager = false,
  onOpen,
}: MessageImageProps) {
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const hasStableDimensions = Number.isFinite(width)
    && Number.isFinite(height)
    && Number(width) > 0
    && Number(height) > 0;
  const initiallyReady = readyMessageImages.has(src);
  const [shouldLoad, setShouldLoad] = useState(
    () => eager || !hasStableDimensions || initiallyReady,
  );
  const [loaded, setLoaded] = useState(initiallyReady);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (shouldLoad || eager || !hasStableDimensions) return;
    const target = containerRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const root = target.closest<HTMLElement>(".messages-scroll");
    if (!root) {
      setShouldLoad(true);
      return;
    }
    return observeMessageImage(root, target, () => {
      setShouldLoad(true);
    });
  }, [eager, hasStableDimensions, shouldLoad]);

  const reservedStyle = hasStableDimensions
    ? {
        width: `${Number(width)}px`,
        maxWidth: "100%",
        aspectRatio: `${Number(width)} / ${Number(height)}`,
      }
    : undefined;

  return (
    <div
      ref={containerRef}
      data-message-media
      className="relative inline-block select-none"
      style={reservedStyle}
      onContextMenu={(event) => event.preventDefault()}
    >
      {shouldLoad && !loaded && !failed && <MediaLoadingDots />}
      {failed ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            readyMessageImages.delete(src);
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
          src={shouldLoad ? src : undefined}
          alt=""
          draggable={false}
          decoding="async"
          className="block h-auto rounded-[15px] select-none"
          style={hasStableDimensions
            ? { display: loaded ? "block" : "none", width: "100%", height: "100%", objectFit: "contain", userSelect: "none" }
            : { display: loaded ? "block" : "none", width: "auto", maxWidth: "100%", objectFit: "contain", userSelect: "none" }}
          onLoad={() => {
            rememberReadyMessageImage(src);
            setLoaded(true);
          }}
          onError={() => {
            readyMessageImages.delete(src);
            setFailed(true);
          }}
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
    ? highlightRenderedText(parts, searchQuery, isActiveMatch)
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
          style={{ display: "block", background: "none", border: "none", color: isMine ? "rgba(255,255,255,0.85)" : "var(--bubble-sent, #3598fe)", cursor: "pointer", padding: "4px 0 0", fontSize: "var(--bubble-font-size)", fontFamily: "inherit", marginLeft: "auto", transform: "rotate(-90deg)", lineHeight: 1 }}
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
