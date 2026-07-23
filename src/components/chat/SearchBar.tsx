"use client";

import { useState, useRef, useEffect } from "react";
import { searchMessages } from "@/lib/api";

interface SearchBarProps {
  channelId: string;
  messages: { id: string; text: string }[];
  onNavigate: (msgId: string) => void;
  onSearchState: (state: { query: string; activeId: string | null; resultIds: string[] }) => void;
  onClose: () => void;
}

export function SearchBar({ channelId, messages, onNavigate, onSearchState, onClose }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; text: string }[]>([]);
  const [index, setIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const updateState = (q: string, res: { id: string }[], idx: number) => {
    onSearchState({
      query: q,
      activeId: idx >= 0 && res[idx] ? res[idx].id : null,
      resultIds: res.map((r) => r.id),
    });
  };

  const performSearch = async (q: string) => {
    if (!q) { setResults([]); setIndex(-1); updateState("", [], -1); return; }

    const queryLower = q.toLowerCase();
    let matched = messages.filter((m) => m.text && m.text.toLowerCase().includes(queryLower));

    try {
      const serverData = await searchMessages(channelId, q);
      if (serverData.results) {
        const byId = new Map(matched.map((m) => [m.id, m]));
        serverData.results.forEach((m: { id: string; text: string }) => byId.set(m.id, m));
        matched = [...byId.values()];
      }
    } catch {}

    setResults(matched);
    if (matched.length > 0) {
      const lastIdx = matched.length - 1;
      setIndex(lastIdx);
      onNavigate(matched[lastIdx].id);
      updateState(q, matched, lastIdx);
    } else {
      setIndex(-1);
      updateState(q, [], -1);
    }
  };

  const navigate = (dir: number) => {
    if (results.length === 0) return;
    let next = index + dir;
    if (next < 0) next = 0;
    if (next >= results.length) next = results.length - 1;
    setIndex(next);
    onNavigate(results[next].id);
    updateState(query, results, next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (results.length === 0) {
        performSearch(query);
      } else {
        navigate(-1);
      }
    }
    if (e.key === "Escape") { onSearchState({ query: "", activeId: null, resultIds: [] }); onClose(); }
  };

  const handleClose = () => {
    onSearchState({ query: "", activeId: null, resultIds: [] });
    onClose();
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "8px 12px", background: "var(--composer-bg)", backdropFilter: "saturate(180%) blur(20px)", WebkitBackdropFilter: "saturate(180%) blur(20px)", borderBottom: "0.5px solid var(--hairline)", flexShrink: 0 }}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setResults([]); setIndex(-1); updateState("", [], -1); }}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (query && results.length === 0) performSearch(query); }}
        placeholder="검색..."
        style={{ flex: 1, minWidth: 0, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--gray-text)", borderRadius: "8px", padding: "6px 10px", fontSize: "var(--bubble-font-size, 15px)", fontFamily: "inherit", outline: "none", lineHeight: 1 }}
      />
      <button
        disabled={results.length === 0 || index <= 0}
        onClick={() => navigate(-1)}
        style={{ background: "none", border: "none", color: (results.length > 0 && index > 0) ? "var(--tint)" : "var(--meta)", cursor: (results.length > 0 && index > 0) ? "pointer" : "default", padding: "5px", display: "flex", alignItems: "center", opacity: (results.length > 0 && index > 0) ? 1 : 0.3 }}
      >
        <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 6px)", height: "calc(var(--bubble-font-size) + 6px)" }}><path d="M18 15l-6-6-6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button
        disabled={results.length === 0 || index >= results.length - 1}
        onClick={() => navigate(1)}
        style={{ background: "none", border: "none", color: (results.length > 0 && index < results.length - 1) ? "var(--tint)" : "var(--meta)", cursor: (results.length > 0 && index < results.length - 1) ? "pointer" : "default", padding: "5px", display: "flex", alignItems: "center", opacity: (results.length > 0 && index < results.length - 1) ? 1 : 0.3 }}
      >
        <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 6px)", height: "calc(var(--bubble-font-size) + 6px)" }}><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button
        onClick={handleClose}
        style={{ background: "none", border: "none", color: "var(--meta)", cursor: "pointer", fontSize: "calc(var(--bubble-font-size) + 2px)", padding: "5px", lineHeight: 1 }}
      >
        ✕
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
