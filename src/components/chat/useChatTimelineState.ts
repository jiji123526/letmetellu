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
  unifiedTimelineEnabled: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setDmMessages: Dispatch<SetStateAction<Message[]>>;
  setUnifiedTimelineEnabled: (enabled: boolean) => void;
  replaceUnifiedTimelinePage: (
    items: ChatTimelineItem[],
    pageStartCursor: UnifiedTimelineCursor | null,
    pageEndCursor: UnifiedTimelineCursor | null,
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
  ) => {
    setState((previous) =>
      replaceUnifiedTimelinePage(previous, items, pageStartCursor, pageEndCursor)
    );
  }, []);

  return {
    messages,
    dmMessages,
    timelineItems: state.mode === "unified" ? state.timelineItems : null,
    pageStartCursor: state.mode === "unified" ? state.pageStartCursor : null,
    pageEndCursor: state.mode === "unified" ? state.pageEndCursor : null,
    unifiedTimelineEnabled: state.mode === "unified",
    setMessages,
    setDmMessages,
    setUnifiedTimelineEnabled,
    replaceUnifiedTimelinePage: replaceTimelinePage,
  };
}
