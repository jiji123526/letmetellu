"use client";

import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Message } from "./chatTypes";
import {
  createInitialChatTimelineState,
  mergeUnifiedTimelineLatestPage,
  mergeUnifiedTimelinePage,
  removeChatTimelineItems,
  removeChatTimelineThread,
  restoreChatTimelineItems,
  selectTimelineDmMessages,
  selectTimelineMessages,
  replaceUnifiedTimelinePage,
  setChatTimelineMode,
  updateChatTimelineSource,
  upsertChatTimelineItems,
  type ChatTimelineIdentity,
  type ChatTimelineItem,
  type ChatTimelineMutationItem,
  type ChatTimelineSource,
  type UnifiedTimelineCursor,
} from "./chatTimelineState";

interface ChatTimelineStateAdapter {
  messages: Message[];
  dmMessages: Message[];
  timelineItems: ChatTimelineItem[] | null;
  pageStartCursor: UnifiedTimelineCursor | null;
  pageEndCursor: UnifiedTimelineCursor | null;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  unifiedTimelineEnabled: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setDmMessages: Dispatch<SetStateAction<Message[]>>;
  upsertTimelineItems: (
    source: ChatTimelineSource,
    messages: Message[],
    requiredRootId?: string,
  ) => void;
  removeTimelineItems: (identities: ReadonlyArray<ChatTimelineIdentity>) => void;
  removeTimelineThread: (source: ChatTimelineSource, rootId: string) => void;
  restoreTimelineItems: (items: ReadonlyArray<ChatTimelineMutationItem>) => void;
  setUnifiedTimelineEnabled: (enabled: boolean) => void;
  replaceUnifiedTimelinePage: (
    items: ChatTimelineItem[],
    pageStartCursor: UnifiedTimelineCursor | null,
    pageEndCursor: UnifiedTimelineCursor | null,
    hasMoreBefore?: boolean,
  ) => void;
  applyUnifiedTimelineBootstrap: (
    items: ChatTimelineItem[],
    pageStartCursor: UnifiedTimelineCursor | null,
    pageEndCursor: UnifiedTimelineCursor | null,
    hasMoreBefore: boolean,
    preserveHistory: boolean,
  ) => void;
  applyUnifiedHistoryPage: (
    direction: "before" | "after",
    items: ChatTimelineItem[],
    pageStartCursor: UnifiedTimelineCursor | null,
    pageEndCursor: UnifiedTimelineCursor | null,
    hasMore: boolean,
  ) => void;
  replaceUnifiedContextPage: (
    items: ChatTimelineItem[],
    pageStartCursor: UnifiedTimelineCursor | null,
    pageEndCursor: UnifiedTimelineCursor | null,
    hasOlder: boolean,
    hasNewer: boolean,
  ) => void;
}

export function useChatTimelineState(): ChatTimelineStateAdapter {
  const [state, setState] = useState(createInitialChatTimelineState);
  const messages = useMemo(() => selectTimelineMessages(state), [state]);
  const dmMessages = useMemo(() => selectTimelineDmMessages(state), [state]);

  const setMessages = useCallback<Dispatch<SetStateAction<Message[]>>>((update) => {
    setState((previous) => updateChatTimelineSource(previous, "message", update));
  }, []);
  const setDmMessages = useCallback<Dispatch<SetStateAction<Message[]>>>((update) => {
    setState((previous) => updateChatTimelineSource(previous, "dm", update));
  }, []);
  const setUnifiedTimelineEnabled = useCallback((enabled: boolean) => {
    setState((previous) => setChatTimelineMode(previous, enabled));
  }, []);
  const upsertTimelineItems = useCallback((
    source: ChatTimelineSource,
    messages: Message[],
    requiredRootId?: string,
  ) => {
    setState((previous) => {
      const sourceItems = source === "message"
        ? selectTimelineMessages(previous)
        : selectTimelineDmMessages(previous);
      if (
        requiredRootId
        && !sourceItems.some((message) => message.id === requiredRootId)
      ) {
        return previous;
      }
      return upsertChatTimelineItems(previous, source, messages);
    });
  }, []);
  const removeTimelineItems = useCallback((
    identities: ReadonlyArray<ChatTimelineIdentity>,
  ) => {
    setState((previous) => removeChatTimelineItems(previous, identities));
  }, []);
  const removeTimelineThread = useCallback((
    source: ChatTimelineSource,
    rootId: string,
  ) => {
    setState((previous) => removeChatTimelineThread(previous, source, rootId));
  }, []);
  const restoreTimelineItems = useCallback((
    items: ReadonlyArray<ChatTimelineMutationItem>,
  ) => {
    setState((previous) => restoreChatTimelineItems(previous, items));
  }, []);
  const replaceTimelinePage = useCallback((
    items: ChatTimelineItem[],
    pageStartCursor: UnifiedTimelineCursor | null,
    pageEndCursor: UnifiedTimelineCursor | null,
    hasMoreBefore = false,
  ) => {
    setState((previous) =>
      replaceUnifiedTimelinePage(
        previous,
        items,
        pageStartCursor,
        pageEndCursor,
        hasMoreBefore,
      )
    );
  }, []);
  const applyUnifiedTimelineBootstrap = useCallback((
    items: ChatTimelineItem[],
    pageStartCursor: UnifiedTimelineCursor | null,
    pageEndCursor: UnifiedTimelineCursor | null,
    hasMoreBefore: boolean,
    preserveHistory: boolean,
  ) => {
    setState((previous) => {
      const unified = setChatTimelineMode(previous, true);
      return preserveHistory
        ? mergeUnifiedTimelineLatestPage(
            unified,
            items,
            pageStartCursor,
            pageEndCursor,
            hasMoreBefore,
          )
        : replaceUnifiedTimelinePage(
            unified,
            items,
            pageStartCursor,
            pageEndCursor,
            hasMoreBefore,
          );
    });
  }, []);
  const applyUnifiedHistoryPage = useCallback((
    direction: "before" | "after",
    items: ChatTimelineItem[],
    pageStartCursor: UnifiedTimelineCursor | null,
    pageEndCursor: UnifiedTimelineCursor | null,
    hasMore: boolean,
  ) => {
    setState((previous) => mergeUnifiedTimelinePage(
      previous,
      direction,
      items,
      pageStartCursor,
      pageEndCursor,
      hasMore,
    ));
  }, []);
  const replaceUnifiedContextPage = useCallback((
    items: ChatTimelineItem[],
    pageStartCursor: UnifiedTimelineCursor | null,
    pageEndCursor: UnifiedTimelineCursor | null,
    hasOlder: boolean,
    hasNewer: boolean,
  ) => {
    setState((previous) => replaceUnifiedTimelinePage(
      previous,
      items,
      pageStartCursor,
      pageEndCursor,
      hasOlder,
      hasNewer,
    ));
  }, []);

  return {
    messages,
    dmMessages,
    timelineItems: state.mode === "unified" ? state.timelineItems : null,
    pageStartCursor: state.mode === "unified" ? state.pageStartCursor : null,
    pageEndCursor: state.mode === "unified" ? state.pageEndCursor : null,
    hasMoreBefore: state.mode === "unified" ? state.hasMoreBefore : false,
    hasMoreAfter: state.mode === "unified" ? state.hasMoreAfter : false,
    unifiedTimelineEnabled: state.mode === "unified",
    setMessages,
    setDmMessages,
    upsertTimelineItems,
    removeTimelineItems,
    removeTimelineThread,
    restoreTimelineItems,
    setUnifiedTimelineEnabled,
    replaceUnifiedTimelinePage: replaceTimelinePage,
    applyUnifiedTimelineBootstrap,
    applyUnifiedHistoryPage,
    replaceUnifiedContextPage,
  };
}
