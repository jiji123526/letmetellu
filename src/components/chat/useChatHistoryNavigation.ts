"use client";

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import { fetchMessageContext, fetchMessagePage, fetchMessages } from "@/lib/api";
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
  scrollToMessage: (msgId: string) => Promise<void>;
}

function flashBubble(element: HTMLElement | null) {
  if (!element) return;
  element.style.transition = "box-shadow .2s";
  element.style.boxShadow = "0 0 0 2.5px var(--bubble-sent)";
  setTimeout(() => {
    element.style.boxShadow = "";
  }, 800);
}

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

function hasPendingContentBeforeTarget(container: HTMLElement, target: HTMLElement): boolean {
  const pendingElements = container.querySelectorAll(".media-loading-dots, img, video");
  return [...pendingElements].some((node) => {
    if (!isBeforeOrInsideTarget(node, target)) return false;
    if (node.classList.contains("media-loading-dots")) return true;
    if (node instanceof HTMLImageElement) return !node.complete;
    return node instanceof HTMLVideoElement && node.readyState < HTMLMediaElement.HAVE_METADATA;
  });
}

async function waitForStableMessageLayout(
  container: HTMLElement,
  target: HTMLElement,
  timeoutMs = 6000,
): Promise<void> {
  const startedAt = performance.now();
  let previousSignature = "";
  let stableFrames = 0;

  while (performance.now() - startedAt < timeoutMs) {
    await nextAnimationFrame();
    const signature = `${container.scrollHeight}:${target.offsetTop}:${target.offsetHeight}`;
    const pendingContent = hasPendingContentBeforeTarget(container, target);
    stableFrames = !pendingContent && signature === previousSignature ? stableFrames + 1 : 0;
    previousSignature = signature;
    if (stableFrames >= 3) return;
  }
}

export function useChatHistoryNavigation({
  channelId,
  messages,
  historyMode,
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

  useEffect(() => {
    historyModeRef.current = historyMode;
  }, [historyMode]);

  const returnToLatest = useCallback(async () => {
    const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
    try {
      const data = await fetchMessages(fetchChannel);
      setMessages(data.messages || []);
      historyModeRef.current = "latest";
      setHistoryMode("latest");
      setNewerMessageCount(0);
      hasMoreNewerMessagesRef.current = false;
      hasMoreMessagesRef.current = (data.messages?.length || 0) >= 50;
      isNearBottomRef.current = true;
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

    if (
      element.scrollTop < 50
      && !loadingMoreRef.current
      && hasMoreMessagesRef.current
      && messages.length > 0
    ) {
      const oldest = messages[0];
      if (!oldest?.created_at) return;

      loadingMoreRef.current = true;
      const anchorId = oldest.id;
      const previousAnchorTop = document.getElementById(`msg-${anchorId}`)?.offsetTop ?? null;
      const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;

      fetchMessagePage(fetchChannel, "before", { createdAt: oldest.created_at, id: oldest.id })
        .then((data) => {
          if (data.messages && data.messages.length > 0) {
            if (data.messages.length < 50) hasMoreMessagesRef.current = false;
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
            requestAnimationFrame(() => {
              const nextAnchorTop = document.getElementById(`msg-${anchorId}`)?.offsetTop ?? null;
              if (previousAnchorTop !== null && nextAnchorTop !== null) {
                element.scrollTop += nextAnchorTop - previousAnchorTop;
              }
            });
          } else {
            hasMoreMessagesRef.current = false;
          }
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
      const anchorId = newest.id;
      const previousAnchorTop = document.getElementById(`msg-${anchorId}`)?.offsetTop ?? null;
      const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;

      fetchMessagePage(fetchChannel, "after", { createdAt: newest.created_at, id: newest.id })
        .then((data) => {
          if (data.messages?.length) {
            if (data.messages.length < 50) hasMoreNewerMessagesRef.current = false;
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
              const nextAnchorTop = document.getElementById(`msg-${anchorId}`)?.offsetTop ?? null;
              if (previousAnchorTop !== null && nextAnchorTop !== null) {
                element.scrollTop += nextAnchorTop - previousAnchorTop;
              }
            });
          } else {
            hasMoreNewerMessagesRef.current = false;
          }
        })
        .finally(() => {
          loadingMoreRef.current = false;
        });
    }
  }, [channelId, inLiveModeRef, messages, messagesContainerRef, setHistoryMode, setMessages, setShowScrollBtn]);

  const scrollToBottom = useCallback(() => {
    if (historyModeRef.current === "context") {
      void returnToLatest();
      return;
    }
    isNearBottomRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollBtn(false);
  }, [messagesEndRef, returnToLatest, setShowScrollBtn]);

  const scrollToMessage = useCallback(async (msgId: string) => {
    await nextAnimationFrame();
    let element = document.getElementById(`msg-${msgId}`);

    if (!element) {
      const fetchChannel = inLiveModeRef.current ? `${channelId}_live` : channelId;
      try {
        const data = await fetchMessageContext(fetchChannel, msgId);
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
        element = null;
      }
    }

    if (!element) {
      setBanner({ text: "Message not found", color: "var(--meta)" });
      setTimeout(() => setBanner(null), 2000);
      return;
    }

    const container = messagesContainerRef.current;
    if (container) {
      await waitForStableMessageLayout(container, element);
    }
    element = document.getElementById(`msg-${msgId}`) || element;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    flashBubble(element.querySelector("[data-bubble]") as HTMLElement | null);
  }, [channelId, inLiveModeRef, messagesContainerRef, setBanner, setHistoryMode, setMessages, setNewerMessageCount]);

  return {
    historyModeRef,
    isNearBottomRef,
    handleScroll,
    scrollToBottom,
    scrollToMessage,
  };
}
