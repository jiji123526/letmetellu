"use client";

import { useState, useRef, useEffect } from "react";
import { searchMessages } from "@/lib/api";

interface SearchBarProps {
  channelId: string;
  messages: { id: string; text: string }[];
  onNavigate: (msgId: string) => void;
  onClose: () => void;
}

export function SearchBar({ channelId, messages, onNavigate, onClose }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; text: string }[]>([]);
  const [index, setIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const performSearch = async (q: string) => {
    if (!q) { setResults([]); setIndex(-1); return; }

    const queryLower = q.toLowerCase();
    // Local search first
    let matched = messages.filter((m) => m.text && m.text.toLowerCase().includes(queryLower));

    // Server search (FTS5)
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
    }
  };

  const navigate = (dir: number) => {
    if (results.length === 0) return;
    let next = index + dir;
    if (next < 0) next = results.length - 1;
    if (next >= results.length) next = 0;
    setIndex(next);
    onNavigate(results[next].id);
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
    if (e.key === "Escape") onClose();
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "8px 12px", background: "var(--composer-bg)", backdropFilter: "saturate(180%) blur(20px)", WebkitBackdropFilter: "saturate(180%) blur(20px)", borderBottom: "0.5px solid var(--hairline)", flexShrink: 0 }}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setResults([]); setIndex(-1); }}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (query && results.length === 0) performSearch(query); }}
        placeholder="검색..."
        style={{ flex: 1, minWidth: 0, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--gray-text)", borderRadius: "8px", padding: "6px 10px", fontSize: "var(--bubble-font-size, 15px)", fontFamily: "inherit", outline: "none", lineHeight: 1 }}
      />
      {/* Prev button */}
      <button
        disabled={results.length === 0}
        onClick={() => navigate(-1)}
        style={{ background: "none", border: "none", color: results.length > 0 ? "var(--tint)" : "var(--meta)", cursor: results.length > 0 ? "pointer" : "default", padding: "5px", display: "flex", alignItems: "center", opacity: results.length > 0 ? 1 : 0.3 }}
      >
        <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 6px)", height: "calc(var(--bubble-font-size) + 6px)" }}><path d="M18 15l-6-6-6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {/* Next button */}
      <button
        disabled={results.length === 0}
        onClick={() => navigate(1)}
        style={{ background: "none", border: "none", color: results.length > 0 ? "var(--tint)" : "var(--meta)", cursor: results.length > 0 ? "pointer" : "default", padding: "5px", display: "flex", alignItems: "center", opacity: results.length > 0 ? 1 : 0.3 }}
      >
        <svg viewBox="0 0 24 24" style={{ width: "calc(var(--bubble-font-size) + 6px)", height: "calc(var(--bubble-font-size) + 6px)" }}><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {/* Close button */}
      <button
        onClick={onClose}
        style={{ background: "none", border: "none", color: "var(--meta)", cursor: "pointer", fontSize: "calc(var(--bubble-font-size) + 2px)", padding: "5px", lineHeight: 1 }}
      >
        ✕
      </button>
    </div>
  );
}
