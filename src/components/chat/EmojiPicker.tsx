"use client";

import { useEffect, useRef } from "react";

interface EmojiPickerProps {
  anchorRect: DOMRect;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ anchorRect, onSelect, onClose }: EmojiPickerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Dynamically import and create the emoji-picker-element
    import("emoji-picker-element").then(() => {
      if (!wrapRef.current) return;
      const picker = document.createElement("emoji-picker");
      picker.setAttribute("locale", "ko");
      picker.setAttribute("data-source", "https://cdn.jsdelivr.net/npm/emoji-picker-element-data/ko/cldr/data.json");
      picker.addEventListener("emoji-click", (ev: Event) => {
        const detail = (ev as CustomEvent).detail;
        onSelect(detail.unicode);
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
      pickerRef.current?.remove();
    };
  }, [onSelect]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener("click", handler), 10);
    return () => document.removeEventListener("click", handler);
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
