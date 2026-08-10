"use client";

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import { fetchMessageContext, fetchMessagePage, fetchMessages } from "@/lib/api-chat";
import { MAX_MOUNTED_HISTORY_MESSAGES, trimMessageWindow } from "./chatMessageUtils";
import type { Message } from "./chatTypes";

type HistoryMode = "latest" | "context";

interface BannerState {
  text: string;
  color: string;
}

interface UseChatHistoryNavigationArgs {
  channelId: string;
  messages: Message[];
  historyMode: HistoryMode;
  enabled: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  inLiveModeRef: MutableRefObject<boolean>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setHistoryMode: Dispatch<SetStateAction<HistoryMode>>;
  setNewerMessageCount: Dispatch<SetStateAction<number>>;
  setShowScrollBtn: Dispatch<SetStateAction<boolean>>;
  setBanner: Dispatch<SetStateAction<BannerState | null>>;
}

interface UseChatHistoryNavigationResult {
  historyModeRef: MutableRefObject<HistoryMode>;
  isNearBottomRef: MutableRefObject<boolean>;
  handleScroll: () => void;
  scrollToBottom: () => void;
  positionAtLatest: () => void;
  scrollToMessage: (msgId: string, alignment?: "message" | "media") => Promise<void>;
  restoreRefreshPosition: () => Promise<boolean>;
}

interface ScrollAnchor {
  id: string;
  top: number;
}

interface SavedScrollPosition {
  messageId: string;
  offset: number;
  live: boolean;
  savedAt: number;
}

const SCROLL_POSITION_MAX_AGE_MS = 30 * 60 * 1000;

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForMessageElement(msgId: string, timeoutMs = 1500): Promise<HTMLElement | null> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const element = document.getElementById(`msg-${msgId}`);
    if (element) return element;
    await nextAnimationFrame();
  }
  return null;
}

function isBeforeOrInsideTarget(node: Element, target: Element): boolean {
  return target.contains(node)
    || Boolean(node.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function hasPendingPositioningContent(container: HTMLElement, target: HTMLElement): boolean {
  const containerRect = container.getBoundingClientRect();
  const preloadTop = containerRect.top - 600;
  const preloadBottom = containerRect.bottom + 600;
  const pendingElements = container.querySelectorAll(".media-loading-dots, img, video");
  return [...pendingElements].some((node) => {
    if (!isBeforeOrInsideTarget(node, target)) return false;
    const nodeRect = node.getBoundingClientRect();
    if (!target.contains(node) && (nodeRect.bottom < preloadTop || nodeRect.top > preloadBottom)) return false;
    if (node.classList.contains("media-loading-dots")) return true;
    if (node instanceof HTMLImageElement) return !node.complete;
    return node instanceof HTMLVideoElement && node.readyState < HTMLMediaElement.HAVE_METADATA;
  });
}

function findScrollAnchor(container: HTMLElement): ScrollAnchor | null {
  const containerTop = container.getBoundingClientRect().top;
  const messages = container.querySelectorAll<HTMLElement>('[id^="msg-"]');

  for (const message of messages) {
    const rect = message.getBoundingClientRect();
    if (rect.bottom > containerTop + 1) {
      return {
        id: message.id,
        top: rect.top - containerTop,
      };
    }
  }

  return null;
}

function getAnchorTop(container: HTMLElement, anchorId: string): number | null {
  const element = document.getElementById(anchorId);
  if (!element) return null;
  const containerTop = container.getBoundingClientRect().top;
  return element.getBoundingClientRect().top - containerTop;
}

function getComparableElement(node: EventTarget | Node | null): Element | null {
  if (!node) return null;
  if (node instanceof Element) return node;
  if (node instanceof Node) return node.parentElement;
  return null;
}

function isRelevantToLockedAnchor(
  container: HTMLElement,
  anchorId: string,
  node: EventTarget | Node | null,
): boolean {
  const anchorElement = document.getElementById(anchorId);
  if (!anchorElement) return true;
  const element = getComparableElement(node);
  if (!element || element === container) return true;
  return isBeforeOrInsideTarget(element, anchorElement);
}

async function waitForStableMessageLayout(
  container: HTMLElement,
  target: HTMLElement,
  timeoutMs = 6000,
): Promise<void> {
  const startedAt = performance.now();
  let previousSignature = "";
  let stableFrames = 0;

  await document.fonts?.ready;
  while (performance.now() - startedAt < timeoutMs) {
    await nextAnimationFrame();
    const signature = `${container.scrollHeight}:${target.offsetTop}:${target.offsetHeight}`;
    stableFrames = !hasPendingPositioningContent(container, target) && signature === previousSignature
      ? stableFrames + 1
      : 0;
    previousSignature = signature;
    if (stableFrames >= 3) return;
  }
}

async function waitForCompleteHistoryWindow(
  container: HTMLElement,
  isCurrent: () => boolean,
  timeoutMs = 45_000,
  boundary?: HTMLElement,
): Promise<"ready" | "timeout" | "cancelled"> {
  const startedAt = performance.now();
  let userInterrupted = false;
  const interrupt = () => { userInterrupted = true; };
  const quietPeriodMs = 900;
  let previousHeight = -1;
  let quietSince: number | null = null;

  container.addEventListener("wheel", interrupt, { passive: true });
  container.addEventListener("touchstart", interrupt, { passive: true });
  container.addEventListener("pointerdown", interrupt, { passive: true });

  try {
    await document.fonts?.ready;

    while (performance.now() - startedAt < timeoutMs) {
      await nextAnimationFrame();
      if (!isCurrent() || userInterrupted) return "cancelled";

      const isRelevant = (node: Element) => !boundary || isBeforeOrInsideTarget(node, boundary);
      const pendingMarker = [...container.querySelectorAll(".media-loading-dots, [data-history-layout-pending]")]
        .some(isRelevant);
      const pendingImage = [...container.querySelectorAll("img")]
        .some((node) => isRelevant(node) && node instanceof HTMLImageElement && !node.complete);
      const pendingVideo = [...container.querySelectorAll("video")]
        .some((node) => isRelevant(node)
          && node instanceof HTMLVideoElement
          && node.networkState !== HTMLMediaElement.NETWORK_NO_SOURCE
          && node.readyState < HTMLMediaElement.HAVE_METADATA);
      const height = boundary ? boundary.offsetTop : container.scrollHeight;
      const pending = pendingMarker || pendingImage || pendingVideo;
      const now = performance.now();

      if (pending || height !== previousHeight) {
        quietSince = null;
      } else if (quietSince === null) {
        quietSince = now;
      } else if (now - quietSince >= quietPeriodMs) {
        return "ready";
      }
      previousHeight = height;
    }
    return "timeout";
  } finally {
    container.removeEventListener("wheel", interrupt);
    container.removeEventListener("touchstart", interrupt);
    container.removeEventListener("pointerdown", interrupt);
  }
}

export function useChatHistoryNavigation({
  channelId,
  messages,
  historyMode,
  enabled,
  messagesContainerRef,
  messagesEndRef,
  inLiveModeRef,
  setMessages,
  setHistoryMode,
  setNewerMessageCount,
  setShowScrollBtn,
  setBanner,
}: UseChatHistoryNavigationArgs): UseChatHistoryNavigationResult {
  const isNearBottomRef = useRef(true);
  const historyModeRef = useRef<HistoryMode>(historyMode);
  const loadingMoreRef = useRef(false);
  const hasMoreMessagesRef = useRef(true);
  const hasMoreNewerMessagesRef = useRef(false);
  const navigationRequestRef = useRef(0);
  const scrollAnchorRef = useRef<ScrollAnchor | null>(null);
  const lockedScrollAnchorRef = useRef<ScrollAnchor | null>(null);
  const lockedScrollDirectionRef = useRef<"older" | "newer" | null>(null);
  const historyLoadAnchorRequestRef = useRef(0);
  const restoreAnchorFrameRef = useRef<number | null>(null);
  const pageExitRef = useRef(false);

  const scrollStorageKey = `chatScrollPosition:${channelId}`;

  const saveScrollPosition = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const messageElements = [...container.querySelectorAll<HTMLElement>('[id^="msg-"]')];
    const anchor = messageElements.find((element) => element.getBoundingClientRect().bottom > containerTop)
      || messageElements.at(-1);
    if (!anchor) return;
    const position: SavedScrollPosition = {
      messageId: anchor.id.slice(4),
      offset: anchor.getBoundingClientRect().top - containerTop,
      live: inLiveModeRef.current,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(scrollStorageKey, JSON.stringify(position));
  }, [inLiveModeRef, messagesContainerRef, scrollStorageKey]);

  useEffect(() => {
    const handlePageExit = () => {
      pageExitRef.current = true;
      saveScrollPosition();
    };
    const handlePageShow = () => {
      pageExitRef.current = false;
    };
    window.addEventListener("beforeunload", handlePageExit);
    window.addEventListener("pagehide", handlePageExit);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("beforeunload", handlePageExit);
      window.removeEventListener("pagehide", handlePageExit);
      window.removeEventListener("pageshow", handlePageShow);
      if (!pageExitRef.current) sessionStorage.removeItem(scrollStorageKey);
    };
  }, [saveScrollPosition, scrollStorageKey]);

  useEffect(() => {
    historyModeRef.current = historyMode;
  }, [historyMode]);

  const updateScrollAnchor = useCallback(() => {
    if (lockedScrollAnchorRef.current) return;
    const container = messagesContainerRef.current;
    if (!container || isNearBottomRef.current) {
      scrollAnchorRef.current = null;
      return;
    }
    scrollAnchorRef.current = findScrollAnchor(container);
  }, [messagesContainerRef]);

  const restoreScrollAnchor = useCallback(() => {
    const container = messagesContainerRef.current;
    const lockedAnchor = lockedScrollAnchorRef.current;
    const anchor = lockedAnchor || scrollAnchorRef.current;
    if (
      !container
      || !anchor
      || (lockedAnchor && lockedScrollDirectionRef.current === "older")
      || (!lockedAnchor && isNearBottomRef.current)
      || loadingMoreRef.current
    ) return;

    const nextTop = getAnchorTop(container, anchor.id);
    if (nextTop === null) return;
    const delta = nextTop - anchor.top;
    if (Math.abs(delta) > 1) {
      container.scrollTop += delta;
    }
  }, [messagesContainerRef]);

  const releaseLockedScrollAnchor = useCallback((requestId: number) => {
    if (historyLoadAnchorRequestRef.current !== requestId) return;
    lockedScrollAnchorRef.current = null;
    lockedScrollDirectionRef.current = null;
    updateScrollAnchor();
  }, [updateScrollAnchor]);

  useEffect(() => {
    if (!enabled) return;
    const container = messagesContainerRef.current;
    if (!container) return;

    const scheduleRestore = () => {
      if (restoreAnchorFrameRef.current !== null) {
        cancelAnimationFrame(restoreAnchorFrameRef.current);
      }
      restoreAnchorFrameRef.current = requestAnimationFrame(() => {
        restoreAnchorFrameRef.current = requestAnimationFrame(() => {
          restoreScrollAnchor();
          updateScrollAnchor();
        });
      });
    };

    const scheduleRestoreForMutations = (records: MutationRecord[]) => {
      const lockedAnchor = lockedScrollAnchorRef.current;
      if (
        lockedAnchor
        && lockedScrollDirectionRef.current === "older"
      ) return;
      if (lockedAnchor) {
        const hasRelevantMutation = records.some((record) => (
          isRelevantToLockedAnchor(container, lockedAnchor.id, record.target)
          || [...record.addedNodes].some((node) =>
            isRelevantToLockedAnchor(container, lockedAnchor.id, node))
        ));
        if (!hasRelevantMutation) return;
      }
      scheduleRestore();
    };

    const scheduleRestoreForEvent = (event: Event) => {
      const lockedAnchor = lockedScrollAnchorRef.current;
      if (
        lockedAnchor
        && lockedScrollDirectionRef.current === "older"
      ) return;
      if (
        lockedAnchor
        && !isRelevantToLockedAnchor(container, lockedAnchor.id, event.target)
      ) {
        return;
      }
      scheduleRestore();
    };

    const observer = new MutationObserver(scheduleRestoreForMutations);
    observer.observe(container, { childList: true, subtree: true });
    container.addEventListener("load", scheduleRestoreForEvent, true);
    container.addEventListener("loadedmetadata", scheduleRestoreForEvent, true);
    container.addEventListener("error", scheduleRestoreForEvent, true);

    return () => {
      observer.disconnect();
      container.removeEventListener("load", scheduleRestoreForEvent, true);
      container.removeEventListener("loadedmetadata", scheduleRestoreForEvent, true);
      container.removeEventListener("error", scheduleRestoreForEvent, true);
      if (restoreAnchorFrameRef.current !== null) {
        cancelAnimationFrame(restoreAnchorFrameRef.current);
        restoreAnchorFrameRef.current = null;
      }
    };
  }, [enabled, messagesContainerRef, restoreScrollAnchor, updateScrollAnchor]);

  const returnToLatest = useCallback(async () => {
    const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
    try {
      const data = await fetchMessages(fetchChannel);
      setMessages(data.messages || []);
      historyModeRef.current = "latest";
      setHistoryMode("latest");
      setNewerMessageCount(0);
      hasMoreNewerMessagesRef.current = false;
      hasMoreMessagesRef.current = typeof data.has_more === "boolean"
        ? data.has_more
        : (data.messages?.length || 0) >= 50;
      isNearBottomRef.current = true;
      scrollAnchorRef.current = null;
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      });
    } catch {
      setBanner({ text: "Failed to load latest messages", color: "#d32f2f" });
      setTimeout(() => setBanner(null), 2000);
    }
  }, [channelId, inLiveModeRef, messagesEndRef, setBanner, setHistoryMode, setMessages, setNewerMessageCount]);

  const handleScroll = useCallback(() => {
    const element = messagesContainerRef.current;
    if (!element) return;

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    isNearBottomRef.current = distanceFromBottom <= 120;
    setShowScrollBtn(distanceFromBottom > 200);
    updateScrollAnchor();

    if (
      element.scrollTop < 50
      && !loadingMoreRef.current
      && hasMoreMessagesRef.current
      && messages.length > 0
    ) {
      const oldest = messages[0];
      if (!oldest?.created_at) return;

      loadingMoreRef.current = true;
      const prependRequestId = ++historyLoadAnchorRequestRef.current;
      const viewportAnchor = findScrollAnchor(element);
      lockedScrollAnchorRef.current = viewportAnchor;
      lockedScrollDirectionRef.current = "older";
      if (viewportAnchor) {
        scrollAnchorRef.current = viewportAnchor;
      }
      const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;

      fetchMessagePage(fetchChannel, "before", { createdAt: oldest.created_at, id: oldest.id })
        .then(async (data) => {
          if (data.messages && data.messages.length > 0) {
            hasMoreMessagesRef.current = typeof data.has_more === "boolean"
              ? data.has_more
              : data.messages.length >= 50;
            setMessages((previous) => {
              const ids = new Set(previous.map((message) => message.id));
              const older = data.messages.filter((message: Message) => !ids.has(message.id));
              const combined = [...older, ...previous];
              if (combined.length <= MAX_MOUNTED_HISTORY_MESSAGES) return combined;
              historyModeRef.current = "context";
              setHistoryMode("context");
              hasMoreNewerMessagesRef.current = true;
              return trimMessageWindow(combined, "older");
            });
            await nextAnimationFrame();
            const anchor = lockedScrollAnchorRef.current;
            const nextAnchorTop = anchor ? getAnchorTop(element, anchor.id) : null;
            if (anchor && nextAnchorTop !== null) {
              element.scrollTop += nextAnchorTop - anchor.top;
            }
            const anchorElement = anchor ? document.getElementById(anchor.id) as HTMLElement | null : null;
            if (!anchorElement) {
              releaseLockedScrollAnchor(prependRequestId);
              return;
            }
            await nextAnimationFrame();
            window.dispatchEvent(new Event("chat-history-preload"));
            const readiness = await waitForCompleteHistoryWindow(
              element,
              () => historyLoadAnchorRequestRef.current === prependRequestId,
              45_000,
              anchorElement,
            );
            if (readiness === "cancelled") {
              releaseLockedScrollAnchor(prependRequestId);
              return;
            }
            const finalAnchor = lockedScrollAnchorRef.current;
            const finalTop = finalAnchor ? getAnchorTop(element, finalAnchor.id) : null;
            if (finalAnchor && finalTop !== null) {
              element.scrollTop += finalTop - finalAnchor.top;
            }
            releaseLockedScrollAnchor(prependRequestId);
          } else {
            hasMoreMessagesRef.current = false;
            releaseLockedScrollAnchor(prependRequestId);
          }
        })
        .catch(() => {
          releaseLockedScrollAnchor(prependRequestId);
        })
        .finally(() => {
          loadingMoreRef.current = false;
        });
    }

    if (
      historyModeRef.current === "context"
      && distanceFromBottom < 50
      && !loadingMoreRef.current
      && hasMoreNewerMessagesRef.current
      && messages.length > 0
    ) {
      const newest = messages[messages.length - 1];
      if (!newest?.created_at) return;

      loadingMoreRef.current = true;
      const appendRequestId = ++historyLoadAnchorRequestRef.current;
      const viewportAnchor = findScrollAnchor(element);
      lockedScrollAnchorRef.current = viewportAnchor;
      lockedScrollDirectionRef.current = "newer";
      if (viewportAnchor) {
        scrollAnchorRef.current = viewportAnchor;
      }
      const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;

      fetchMessagePage(fetchChannel, "after", { createdAt: newest.created_at, id: newest.id })
        .then((data) => {
          if (data.messages?.length) {
            hasMoreNewerMessagesRef.current = typeof data.has_more === "boolean"
              ? data.has_more
              : data.messages.length >= 50;
            setMessages((previous) => {
              const byId = new Map(previous.map((message) => [message.id, message]));
              for (const message of data.messages as Message[]) {
                byId.set(message.id, message);
              }
              const combined = [...byId.values()].sort((left, right) =>
                (left.created_at || "").localeCompare(right.created_at || "")
              );
              if (combined.length <= MAX_MOUNTED_HISTORY_MESSAGES) return combined;
              hasMoreMessagesRef.current = true;
              return trimMessageWindow(combined, "newer");
            });
            requestAnimationFrame(() => {
              const anchor = lockedScrollAnchorRef.current;
              const nextAnchorTop = anchor ? getAnchorTop(element, anchor.id) : null;
              if (anchor && nextAnchorTop !== null) {
                element.scrollTop += nextAnchorTop - anchor.top;
              }
              const anchorElement = anchor ? document.getElementById(anchor.id) as HTMLElement | null : null;
              if (!anchorElement) {
                releaseLockedScrollAnchor(appendRequestId);
                return;
              }
              void waitForStableMessageLayout(element, anchorElement).finally(() => {
                restoreScrollAnchor();
                releaseLockedScrollAnchor(appendRequestId);
              });
            });
          } else {
            hasMoreNewerMessagesRef.current = false;
            releaseLockedScrollAnchor(appendRequestId);
          }
        })
        .catch(() => {
          releaseLockedScrollAnchor(appendRequestId);
        })
        .finally(() => {
          loadingMoreRef.current = false;
        });
    }
  }, [
    channelId,
    inLiveModeRef,
    messages,
    messagesContainerRef,
    releaseLockedScrollAnchor,
    restoreScrollAnchor,
    setHistoryMode,
    setMessages,
    setShowScrollBtn,
    updateScrollAnchor,
  ]);

  const scrollToBottom = useCallback(() => {
    if (historyModeRef.current === "context") {
      void returnToLatest();
      return;
    }
    isNearBottomRef.current = true;
    scrollAnchorRef.current = null;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollBtn(false);
  }, [messagesEndRef, returnToLatest, setShowScrollBtn]);

  const positionAtLatest = useCallback(() => {
    historyModeRef.current = "latest";
    setHistoryMode("latest");
    setNewerMessageCount(0);
    hasMoreNewerMessagesRef.current = false;
    isNearBottomRef.current = true;
    scrollAnchorRef.current = null;
    setShowScrollBtn(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      });
    });
  }, [messagesEndRef, setHistoryMode, setNewerMessageCount, setShowScrollBtn]);

  const scrollToMessage = useCallback(async (msgId: string, alignment: "message" | "media" = "message") => {
    const navigationRequest = ++navigationRequestRef.current;
    await nextAnimationFrame();
    let element = document.getElementById(`msg-${msgId}`);
    const fallbackElement = element;

    const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
    try {
      const data = await fetchMessageContext(fetchChannel, msgId);
      if (navigationRequest !== navigationRequestRef.current) return;
      if (!data.messages?.some((message: Message) => message.id === msgId)) {
        throw new Error("message not found");
      }
      setMessages(data.messages as Message[]);
      historyModeRef.current = "context";
      setHistoryMode("context");
      setNewerMessageCount(0);
      hasMoreMessagesRef.current = data.has_older !== false;
      hasMoreNewerMessagesRef.current = data.has_newer !== false;
      element = await waitForMessageElement(msgId);
    } catch {
      element = fallbackElement || null;
    }

    if (!element) {
      if (navigationRequest !== navigationRequestRef.current) return;
      setBanner({ text: "Message not found", color: "var(--meta)" });
      setTimeout(() => setBanner(null), 2000);
      return;
    }

    if (navigationRequest !== navigationRequestRef.current) return;
    element = document.getElementById(`msg-${msgId}`) || element;
    const container = messagesContainerRef.current;
    if (container) {
      await nextAnimationFrame();
      window.dispatchEvent(new Event("chat-history-preload"));
      const readiness = await waitForCompleteHistoryWindow(
        container,
        () => navigationRequest === navigationRequestRef.current,
      );
      if (readiness === "cancelled") return;
    }
    if (navigationRequest !== navigationRequestRef.current) return;
    element = document.getElementById(`msg-${msgId}`) || element;
    const finalAlignmentElement = alignment === "media"
      ? element.querySelector<HTMLElement>("[data-message-media]") || element
      : element;
    finalAlignmentElement.scrollIntoView({ behavior: "auto", block: "center" });
  }, [channelId, inLiveModeRef, messagesContainerRef, setBanner, setHistoryMode, setMessages, setNewerMessageCount]);

  const restoreRefreshPosition = useCallback(async () => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const rawPosition = sessionStorage.getItem(scrollStorageKey);
    sessionStorage.removeItem(scrollStorageKey);
    if (navigation?.type !== "reload") return false;
    if (!rawPosition) return false;

    let position: SavedScrollPosition;
    try {
      position = JSON.parse(rawPosition) as SavedScrollPosition;
    } catch {
      return false;
    }
    if (
      !position.messageId
      || !Number.isFinite(position.offset)
      || !Number.isFinite(position.savedAt)
      || position.live !== inLiveModeRef.current
      || Date.now() - position.savedAt > SCROLL_POSITION_MAX_AGE_MS
    ) return false;

    let element = document.getElementById(`msg-${position.messageId}`);
    if (!element) {
      const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
      try {
        const data = await fetchMessageContext(fetchChannel, position.messageId);
        if (!data.messages?.some((message: Message) => message.id === position.messageId)) return false;
        setMessages(data.messages as Message[]);
        historyModeRef.current = "context";
        setHistoryMode("context");
        setNewerMessageCount(0);
        hasMoreMessagesRef.current = data.has_older !== false;
        hasMoreNewerMessagesRef.current = data.has_newer !== false;
        element = await waitForMessageElement(position.messageId);
      } catch {
        return false;
      }
    }

    const container = messagesContainerRef.current;
    if (!container || !element) return false;
    const alignToSavedOffset = () => {
      const containerTop = container.getBoundingClientRect().top;
      container.scrollTop += element!.getBoundingClientRect().top - containerTop - position.offset;
    };
    alignToSavedOffset();
    await waitForStableMessageLayout(container, element);
    alignToSavedOffset();
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isNearBottomRef.current = distanceFromBottom <= 120;
    scrollAnchorRef.current = isNearBottomRef.current ? null : findScrollAnchor(container);
    setShowScrollBtn(distanceFromBottom > 200);
    return true;
  }, [channelId, inLiveModeRef, messagesContainerRef, scrollStorageKey, setHistoryMode, setMessages, setNewerMessageCount, setShowScrollBtn]);

  return {
    historyModeRef,
    isNearBottomRef,
    handleScroll,
    scrollToBottom,
    positionAtLatest,
    scrollToMessage,
    restoreRefreshPosition,
  };
}
