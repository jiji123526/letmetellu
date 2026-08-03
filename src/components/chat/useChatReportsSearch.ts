"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { deleteMessage, sendMessage as sendMessageApi } from "@/lib/api";
import {
  deriveChatMessageCollections,
  type ReportsOwnerFilter,
  type RestrictedChannelSummaryItem,
  type ThreadedMessages,
} from "./chatMessageSelectors";
import type { Message } from "./chatTypes";

interface BannerState {
  text: string;
  color: string;
}

export interface ChatSearchState {
  query: string;
  activeId: string | null;
  resultIds: string[];
}

interface UseChatReportsSearchArgs {
  channelId: string;
  uid: string;
  inLiveMode: boolean;
  messages: Message[];
  dmMessages: Message[];
  blockedUsers: ReadonlyArray<{ uid: string; reason?: string }>;
  effectiveAdmin: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setBanner: Dispatch<SetStateAction<BannerState | null>>;
  text: {
    reportPrefix: string;
    reported: string;
    unreported: string;
  };
}

interface UseChatReportsSearchResult {
  showSearch: boolean;
  searchState: ChatSearchState;
  searchResultIdSet: Set<string>;
  isReportsChannelView: boolean;
  reportsOwnerFilter: ReportsOwnerFilter;
  reportedMsgIds: Set<string>;
  isReportsOwnerView: boolean;
  restrictedChannels: RestrictedChannelSummaryItem[];
  blockedUidSet: Set<string>;
  reportedTargetIds: Set<string>;
  threadedMessages: ThreadedMessages;
  toggleSearch: () => void;
  closeSearch: () => void;
  setSearchState: Dispatch<SetStateAction<ChatSearchState>>;
  setReportsChannelView: (nextValue: boolean) => void;
  toggleReportsOwnerFilter: (filter: Exclude<ReportsOwnerFilter, null>) => void;
  reportMessage: (message: Message) => void;
  unreportMessage: (message: Message) => void;
  isMessageReported: (messageId: string) => boolean;
}

const EMPTY_SEARCH_STATE: ChatSearchState = {
  query: "",
  activeId: null,
  resultIds: [],
};

function readReportedMessageIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem("reportedMsgIds") || "[]"));
  } catch {
    return new Set();
  }
}

function persistReportedMessageIds(ids: Set<string>) {
  localStorage.setItem("reportedMsgIds", JSON.stringify([...ids]));
}

export function useChatReportsSearch({
  channelId,
  uid,
  inLiveMode,
  messages,
  dmMessages,
  blockedUsers,
  effectiveAdmin,
  setMessages,
  setBanner,
  text,
}: UseChatReportsSearchArgs): UseChatReportsSearchResult {
  const [showSearch, setShowSearch] = useState(false);
  const [searchState, setSearchState] = useState<ChatSearchState>(EMPTY_SEARCH_STATE);
  const [isReportsChannelView, setIsReportsChannelView] = useState(false);
  const [reportsOwnerFilter, setReportsOwnerFilter] = useState<ReportsOwnerFilter>(null);
  const [reportedMsgIds, setReportedMsgIds] = useState<Set<string>>(readReportedMessageIds);

  useEffect(() => {
    setIsReportsChannelView(false);
    setReportsOwnerFilter(null);
  }, [channelId]);

  const {
    isReportsOwnerView,
    restrictedChannels,
    blockedUidSet,
    reportedTargetIds,
    threadedMessages,
  } = useMemo(
    () => deriveChatMessageCollections({
      messages,
      dmMessages,
      blockedUsers,
      effectiveAdmin,
      isReportsChannelView,
      reportsOwnerFilter,
    }),
    [blockedUsers, dmMessages, effectiveAdmin, isReportsChannelView, messages, reportsOwnerFilter],
  );

  const searchResultIdSet = useMemo(
    () => new Set(searchState.resultIds),
    [searchState.resultIds],
  );

  const toggleSearch = useCallback(() => {
    setShowSearch((current) => !current);
  }, []);

  const closeSearch = useCallback(() => {
    setShowSearch(false);
  }, []);

  const setReportsChannelView = useCallback((nextValue: boolean) => {
    setIsReportsChannelView(nextValue);
  }, []);

  const toggleReportsOwnerFilter = useCallback((filter: Exclude<ReportsOwnerFilter, null>) => {
    setReportsOwnerFilter((current) => current === filter ? null : filter);
  }, []);

  const reportMessage = useCallback((message: Message) => {
    const messageId = message.id;
    setReportedMsgIds((previous) => {
      const next = new Set(previous);
      next.add(messageId);
      persistReportedMessageIds(next);
      return next;
    });

    const previewText = message.text.length > 50 ? `${message.text.slice(0, 50)}…` : message.text;
    void sendMessageApi({
      uid,
      text: `${text.reportPrefix}: "${previewText}"`,
      channel_id: channelId,
      report: true,
      reported_msg_id: messageId,
    } as never);
    setBanner({ text: text.reported, color: "#d32f2f" });
    setTimeout(() => setBanner(null), 3000);
  }, [channelId, setBanner, text.reportPrefix, text.reported, uid]);

  const unreportMessage = useCallback((message: Message) => {
    const messageId = message.id;
    setReportedMsgIds((previous) => {
      const next = new Set(previous);
      next.delete(messageId);
      persistReportedMessageIds(next);
      return next;
    });

    const reportMessageEntry = messages.find(
      (candidate) => candidate.report && candidate.reported_msg_id === messageId && candidate.uid === uid,
    );
    if (reportMessageEntry) {
      void deleteMessage({
        uid,
        message_id: reportMessageEntry.id,
        channel_id: inLiveMode ? `${channelId}_live` : channelId,
        soft: false,
      });
      setMessages((previous) => previous.filter((candidate) => candidate.id !== reportMessageEntry.id));
    }

    setBanner({ text: text.unreported, color: "var(--meta)" });
    setTimeout(() => setBanner(null), 3000);
  }, [channelId, inLiveMode, messages, setBanner, setMessages, text.unreported, uid]);

  const isMessageReported = useCallback((messageId: string) => {
    return reportedMsgIds.has(messageId);
  }, [reportedMsgIds]);

  return {
    showSearch,
    searchState,
    searchResultIdSet,
    isReportsChannelView,
    reportsOwnerFilter,
    reportedMsgIds,
    isReportsOwnerView,
    restrictedChannels,
    blockedUidSet,
    reportedTargetIds,
    threadedMessages,
    toggleSearch,
    closeSearch,
    setSearchState,
    setReportsChannelView,
    toggleReportsOwnerFilter,
    reportMessage,
    unreportMessage,
    isMessageReported,
  };
}
