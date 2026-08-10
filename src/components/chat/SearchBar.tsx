"use client";

import { CloseIcon } from "@/components/ui/CloseIcon";
import { useState, useRef, useEffect } from "react";
import { useLocale } from "@/hooks/useLocale";
import {
  searchMessages,
  type MessageSearchCursor,
  type MessageSearchResult,
} from "@/lib/api-chat";

interface SearchMessage {
  id: string;
  text: string;
  created_at?: string;
}

interface SearchBarProps {
  channelId: string;
  messages: SearchMessage[];
  onNavigate: (msgId: string, options?: { anchorMessageId?: string | null }) => void;
  onSearchState: (state: { query: string; activeId: string | null; resultIds: string[] }) => void;
  onClose: () => void;
}

const SEARCH_URL_REGEX = /(https?:\/\/[^\s<]+|(?:www\.|(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|dev|app|co|me|tv|gg|xyz|kr|jp))(?:\/[^\s<]*)?)/gi;

function mergeSearchResults(
  existing: SearchMessage[],
  incoming: MessageSearchResult[],
): SearchMessage[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort((left, right) => {
    const dateOrder = (left.created_at || "").localeCompare(right.created_at || "");
    return dateOrder || left.id.localeCompare(right.id);
  });
}

function stripLinksForSearch(text: string): string {
  return text.replace(SEARCH_URL_REGEX, " ").replace(/\s+/g, " ").trim();
}

function filterSearchResults<T extends SearchMessage>(messages: T[], normalizedQuery: string): T[] {
  const queryLower = normalizedQuery.toLowerCase();
  return messages.filter((message) =>
    !!message.text && stripLinksForSearch(message.text).toLowerCase().includes(queryLower));
}

export function SearchBar({ channelId, messages, onNavigate, onSearchState, onClose }: SearchBarProps) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMessage[]>([]);
  const [index, setIndex] = useState(-1);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<MessageSearchCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurFromEnterRef = useRef(false);
  const paginationInFlightRef = useRef(false);
  const searchRequestIdRef = useRef(0);
  const resultIdsRef = useRef<string[]>([]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const updateState = (q: string, resultIds: string[], idx: number) => {
    onSearchState({
      query: q,
      activeId: idx >= 0 && resultIds[idx] ? resultIds[idx] : null,
      resultIds,
    });
  };

  const loadVisibleServerResults = async (
    normalizedQuery: string,
    cursor?: MessageSearchCursor | null,
  ): Promise<{
    results: MessageSearchResult[];
    has_more: boolean;
    next_cursor: MessageSearchCursor | null;
  }> => {
    let pageCursor = cursor ?? null;

    while (true) {
      const serverData = await searchMessages(channelId, normalizedQuery, pageCursor);
      const visibleResults = filterSearchResults(serverData.results, normalizedQuery);
      if (visibleResults.length > 0 || !serverData.has_more || !serverData.next_cursor) {
        return {
          results: visibleResults,
          has_more: serverData.has_more,
          next_cursor: serverData.next_cursor,
        };
      }
      pageCursor = serverData.next_cursor;
    }
  };

  const performSearch = async (q: string) => {
    const normalizedQuery = q.trim();
    const requestId = ++searchRequestIdRef.current;
    if (!normalizedQuery) {
      setResults([]);
      setIndex(-1);
      setHasMore(false);
      setNextCursor(null);
      resultIdsRef.current = [];
      updateState("", resultIdsRef.current, -1);
      return;
    }

    let matched = filterSearchResults(messages, normalizedQuery);
    let nextHasMore = false;
    let nextPageCursor: MessageSearchCursor | null = null;

    try {
      const serverData = await loadVisibleServerResults(normalizedQuery);
      if (requestId !== searchRequestIdRef.current) return;
      matched = mergeSearchResults(matched, serverData.results);
      nextHasMore = serverData.has_more;
      nextPageCursor = serverData.next_cursor;
    } catch {}

    if (requestId !== searchRequestIdRef.current) return;
    setResults(matched);
    setHasMore(nextHasMore);
    setNextCursor(nextPageCursor);
    resultIdsRef.current = matched.map((message) => message.id);
    if (matched.length > 0) {
      const lastIdx = matched.length - 1;
      setIndex(lastIdx);
      onNavigate(matched[lastIdx].id);
      updateState(normalizedQuery, resultIdsRef.current, lastIdx);
    } else {
      setIndex(-1);
      resultIdsRef.current = [];
      updateState(normalizedQuery, resultIdsRef.current, -1);
    }
  };

  const navigate = async (dir: number) => {
    if (results.length === 0) return;

    if (
      dir < 0
      && index <= 0
      && hasMore
      && nextCursor
      && !paginationInFlightRef.current
    ) {
      paginationInFlightRef.current = true;
      setLoadingMore(true);
      const requestId = searchRequestIdRef.current;
      const currentId = results[index]?.id;
      try {
        const serverData = await loadVisibleServerResults(query.trim(), nextCursor);
        if (requestId !== searchRequestIdRef.current) return;
        const merged = mergeSearchResults(results, serverData.results);
        const currentIndex = Math.max(0, merged.findIndex((message) => message.id === currentId));
        const nextIndex = Math.max(0, currentIndex - 1);
        setResults(merged);
        setIndex(nextIndex);
        setHasMore(serverData.has_more);
        setNextCursor(serverData.next_cursor);
        resultIdsRef.current = merged.map((message) => message.id);
        onNavigate(merged[nextIndex].id, { anchorMessageId: currentId });
        updateState(query.trim(), resultIdsRef.current, nextIndex);
      } catch {
        // Keep the current result page available when loading older matches fails.
      } finally {
        paginationInFlightRef.current = false;
        setLoadingMore(false);
      }
      return;
    }

    let next = index + dir;
    if (next < 0) next = 0;
    if (next >= results.length) next = results.length - 1;
    setIndex(next);
    onNavigate(results[next].id, { anchorMessageId: results[index]?.id || null });
    updateState(query, resultIdsRef.current, next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      blurFromEnterRef.current = true;
      inputRef.current?.blur(); // dismiss keyboard on mobile
      if (results.length === 0) {
        void performSearch(query);
      } else {
        void navigate(-1);
      }
    }
    if (e.key === "Escape") {
      resultIdsRef.current = [];
      onSearchState({ query: "", activeId: null, resultIds: resultIdsRef.current });
      onClose();
    }
  };

  const handleClose = () => {
    resultIdsRef.current = [];
    onSearchState({ query: "", activeId: null, resultIds: resultIdsRef.current });
    onClose();
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "8px 12px", background: "var(--composer-bg)", backdropFilter: "saturate(180%) blur(20px)", WebkitBackdropFilter: "saturate(180%) blur(20px)", borderBottom: "0.5px solid var(--hairline)", flexShrink: 0 }}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          searchRequestIdRef.current += 1;
          setQuery(e.target.value);
          setResults([]);
          setIndex(-1);
          setHasMore(false);
          setNextCursor(null);
          resultIdsRef.current = [];
          updateState("", resultIdsRef.current, -1);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (blurFromEnterRef.current) {
            blurFromEnterRef.current = false;
            return;
          }
          if (query && results.length === 0) void performSearch(query);
        }}
        placeholder={t("searchPlaceholder")}
        style={{ flex: 1, minWidth: 0, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--gray-text)", borderRadius: "8px", padding: "6px 10px", fontSize: "var(--bubble-font-size, 15px)", fontFamily: "inherit", outline: "none", lineHeight: 1 }}
      />
      <button
        disabled={results.length === 0 || loadingMore || (index <= 0 && !hasMore)}
        onClick={() => void navigate(-1)}
        style={{ background: "none", border: "none", color: (results.length > 0 && (index > 0 || hasMore) && !loadingMore) ? "var(--tint)" : "var(--meta)", cursor: (results.length > 0 && (index > 0 || hasMore) && !loadingMore) ? "pointer" : "default", padding: "5px", display: "flex", alignItems: "center", opacity: (results.length > 0 && (index > 0 || hasMore) && !loadingMore) ? 1 : 0.3 }}
      >
        <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 6px)", height: "calc(var(--bubble-font-size) + 6px)" }}><path d="M18 15l-6-6-6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button
        disabled={results.length === 0 || index >= results.length - 1}
        onClick={() => void navigate(1)}
        style={{ background: "none", border: "none", color: (results.length > 0 && index < results.length - 1) ? "var(--tint)" : "var(--meta)", cursor: (results.length > 0 && index < results.length - 1) ? "pointer" : "default", padding: "5px", display: "flex", alignItems: "center", opacity: (results.length > 0 && index < results.length - 1) ? 1 : 0.3 }}
      >
        <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 6px)", height: "calc(var(--bubble-font-size) + 6px)" }}><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button
        onClick={handleClose}
        aria-label={t("close")}
        style={{ background: "none", border: "none", color: "var(--meta)", cursor: "pointer", padding: "4px 8px", lineHeight: 1 }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

// Helper: highlight text with search query
export function highlightText(text: string, query: string, isActive: boolean): React.ReactNode {
  if (!query || !text) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} style={{ background: isActive ? "#ff9800" : "#ffd54f", color: isActive ? "#fff" : "#000", borderRadius: "2px", padding: "0 1px" }}>{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}
