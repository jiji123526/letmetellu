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
  selectTimelineDmMessages,
  selectTimelineMessages,
  replaceUnifiedTimelinePage,
  setChatTimelineMode,
  updateChatTimelineSource,
  type ChatTimelineItem,
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
    setUnifiedTimelineEnabled,
    replaceUnifiedTimelinePage: replaceTimelinePage,
    applyUnifiedTimelineBootstrap,
    applyUnifiedHistoryPage,
    replaceUnifiedContextPage,
  };
}
