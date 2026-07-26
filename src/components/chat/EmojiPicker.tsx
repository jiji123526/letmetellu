"use client";

import { useEffect, useRef } from "react";

const EN_EMOJI_DATA = "https://cdn.jsdelivr.net/npm/emoji-picker-element-data@^1/en/emojibase/data.json";
const KO_EMOJI_DATA = "https://cdn.jsdelivr.net/npm/emoji-picker-element-data@^1/ko/cldr/data.json";

interface EmojiDataEntry {
  emoji: string;
  annotation?: string;
  tags?: string[];
  shortcodes?: string[];
  [key: string]: unknown;
}

let bilingualDataSourcePromise: Promise<string> | null = null;

function getBilingualDataSource() {
  if (bilingualDataSourcePromise) return bilingualDataSourcePromise;
  bilingualDataSourcePromise = Promise.all([
    fetch(EN_EMOJI_DATA).then((response) => {
      if (!response.ok) throw new Error("English emoji data unavailable");
      return response.json() as Promise<EmojiDataEntry[]>;
    }),
    fetch(KO_EMOJI_DATA).then((response) => {
      if (!response.ok) throw new Error("Korean emoji data unavailable");
      return response.json() as Promise<EmojiDataEntry[]>;
    }),
  ]).then(([english, korean]) => {
    const koreanByEmoji = new Map(korean.map((entry) => [entry.emoji, entry]));
    const merged = english.map((entry) => {
      const localized = koreanByEmoji.get(entry.emoji);
      if (!localized) return entry;
      return {
        ...entry,
        tags: [...new Set([
          ...(entry.tags || []),
          ...(entry.shortcodes || []),
          localized.annotation || "",
          ...(localized.tags || []),
          ...(localized.shortcodes || []),
        ].filter(Boolean))],
      };
    });
    return URL.createObjectURL(new Blob([JSON.stringify(merged)], { type: "application/json" }));
  }).catch(() => KO_EMOJI_DATA);
  return bilingualDataSourcePromise;
}

interface EmojiPickerProps {
  anchorRect: DOMRect;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ anchorRect, onSelect, onClose }: EmojiPickerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLElement | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;
    let picker: HTMLElement | null = null;

    Promise.all([
      import("emoji-picker-element"),
      getBilingualDataSource(),
    ]).then(([module, dataSource]) => {
      if (cancelled || !wrapRef.current) return;
      picker = new module.Picker({
        locale: "ko-x-yap-bilingual",
        dataSource,
      }) as HTMLElement;
      picker.addEventListener("emoji-click", (ev: Event) => {
        const detail = (ev as CustomEvent).detail;
        onSelectRef.current(detail.unicode);
      });
      // Style the picker via CSS vars
      picker.style.setProperty("--border-color", "var(--hairline)");
      picker.style.setProperty("--background", "var(--bg)");
      picker.style.setProperty("--input-border-color", "var(--input-border)");
      picker.style.setProperty("--category-font-size", "14px");
      picker.style.height = "320px";
      picker.style.width = "300px";
      wrapRef.current.appendChild(picker);
      pickerRef.current = picker;
    });

    return () => {
      cancelled = true;
      picker?.remove();
      if (pickerRef.current === picker) pickerRef.current = null;
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = window.setTimeout(() => document.addEventListener("click", handler), 10);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("click", handler);
    };
  }, [onClose]);

  // Position
  const pickerH = 320;
  const pickerW = 300;
  let top = anchorRect.top - pickerH - 8;
  if (top < 10) top = anchorRect.bottom + 8;
  if (top + pickerH > window.innerHeight - 10) top = window.innerHeight - pickerH - 10;
  let left = Math.min(anchorRect.left, window.innerWidth - pickerW - 10);
  if (left < 10) left = 10;

  return (
    <div
      ref={wrapRef}
      className="fixed z-[110] rounded-[14px] overflow-hidden animate-[ctxPop_0.15s_ease]"
      style={{
        top,
        left,
        boxShadow: "0 8px 30px rgba(0,0,0,.2)",
      }}
    />
  );
}
