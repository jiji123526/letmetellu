"use client";

import { useEffect, useRef } from "react";
import { buildEmojiPicker } from "./emojiPickerData";

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

    buildEmojiPicker({
      height: "320px",
      onSelect: (emoji) => onSelectRef.current(emoji),
      width: "300px",
    }).then((nextPicker) => {
      if (cancelled || !wrapRef.current) return;
      picker = nextPicker;
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
