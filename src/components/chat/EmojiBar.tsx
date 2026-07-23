"use client";

import { useState, useEffect } from "react";

const DEFAULT_EMOJIS = ["🍋", "🔥", "❤️", "😂", "👏", "🎉"];

interface EmojiBarProps {
  channelId: string;
  onBroadcast: (emoji: string, x: number, h: number) => void;
}

function getPresetEmojis(channelId: string): string[] {
  if (typeof window === "undefined") return DEFAULT_EMOJIS;
  try {
    const stored = localStorage.getItem(`liveEmojis_${channelId}_live`);
    if (stored) return JSON.parse(stored);
  } catch {}
  return DEFAULT_EMOJIS;
}

export function EmojiBar({ channelId, onBroadcast }: EmojiBarProps) {
  const [showGrid, setShowGrid] = useState(false);
  const [emojis] = useState(() => getPresetEmojis(channelId));

  const triggerEmoji = (emoji: string) => {
    const x = 30 + Math.random() * 40;
    const h = 65 + Math.random() * 25;
    spawnEmoji(emoji, x, h);
    onBroadcast(emoji, x, h);
  };

  return (
    <>
      <button
        style={{ border: "none", background: "none", fontSize: "calc(var(--bubble-font-size) + 2px)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, width: "calc(var(--bubble-font-size) + 9px)", height: "calc(var(--bubble-font-size) + 9px)", marginRight: "4px", lineHeight: 1 }}
        onClick={() => setShowGrid(!showGrid)}
      >
        {emojis[0]}
      </button>

      {showGrid && (
        <EmojiGrid emojis={emojis} onSelect={triggerEmoji} onClose={() => setShowGrid(false)} />
      )}
    </>
  );
}

function EmojiGrid({ emojis, onSelect, onClose }: { emojis: string[]; onSelect: (emoji: string) => void; onClose: () => void }) {
  const [showFullPicker, setShowFullPicker] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".emoji-fx-grid-container") && !target.closest(".emoji-fx-full-picker")) onClose();
    };
    setTimeout(() => document.addEventListener("click", handler), 10);
    return () => document.removeEventListener("click", handler);
  }, [onClose]);

  return (
    <>
      <div
        className="emoji-fx-grid-container"
        style={{
          position: "fixed",
          bottom: "70px",
          right: "12px",
          display: "flex",
          gap: "4px",
          background: "rgba(255,255,255,.85)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderRadius: "22px",
          padding: "6px 8px",
          boxShadow: "0 4px 20px rgba(0,0,0,.15)",
          zIndex: 300,
        }}
      >
        {emojis.map((emoji) => (
          <button
            key={emoji}
            className="hover:scale-[1.2] active:scale-[1.4] transition-transform"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "calc(var(--bubble-font-size) + 3px)",
              width: "calc(var(--bubble-font-size) + 19px)",
              height: "calc(var(--bubble-font-size) + 19px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              lineHeight: 1,
            }}
            onClick={() => onSelect(emoji)}
          >
            {emoji}
          </button>
        ))}
        {/* + button for full picker */}
        <button
          className="hover:scale-[1.2] active:scale-[1.4] transition-transform"
          style={{
            border: "none",
            cursor: "pointer",
            fontSize: "calc(var(--bubble-font-size) + 1px)",
            width: "calc(var(--bubble-font-size) + 19px)",
            height: "calc(var(--bubble-font-size) + 19px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            lineHeight: 1,
            background: "var(--hairline)",
            color: "var(--meta)",
          }}
          onClick={() => setShowFullPicker(!showFullPicker)}
        >
          +
        </button>
      </div>

      {/* Full emoji picker */}
      {showFullPicker && (
        <div
          className="emoji-fx-full-picker"
          style={{ position: "fixed", bottom: "120px", right: "12px", zIndex: 301, borderRadius: "14px", overflow: "hidden", boxShadow: "0 8px 30px rgba(0,0,0,.2)" }}
          ref={(el) => {
            if (el && !el.querySelector("emoji-picker")) {
              import("emoji-picker-element").then(() => {
                const picker = document.createElement("emoji-picker");
                picker.setAttribute("locale", "ko");
                picker.style.height = "320px";
                picker.style.width = "300px";
                picker.addEventListener("emoji-click", (ev: Event) => {
                  const detail = (ev as CustomEvent).detail;
                  onSelect(detail.unicode);
                });
                el.appendChild(picker);
              });
            }
          }}
        />
      )}
    </>
  );
}

// Spawn a floating emoji animation — size matches font setting
export function spawnEmoji(emoji: string, x: number, h: number) {
  if (typeof document === "undefined") return;
  const el = document.createElement("div");
  el.textContent = emoji;
  el.style.position = "fixed";
  el.style.bottom = "0";
  el.style.left = `${x}%`;
  el.style.fontSize = "calc(var(--bubble-font-size) + 11px)";
  el.style.zIndex = "999";
  el.style.pointerEvents = "none";
  el.style.setProperty("--fly-h", `${h}vh`);
  el.style.animation = "emojiFly 2s ease-out forwards";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

// Emoji Preset Panel (admin, in live mode)
interface EmojiPresetPanelProps {
  channelId: string;
  onClose: () => void;
}

export function EmojiPresetPanel({ channelId, onClose }: EmojiPresetPanelProps) {
  const [emojis, setEmojis] = useState<string[]>(() => getPresetEmojis(channelId));

  const save = (next: string[]) => {
    setEmojis(next);
    localStorage.setItem(`liveEmojis_${channelId}_live`, JSON.stringify(next));
  };

  const addEmoji = (emoji: string) => {
    if (!emojis.includes(emoji)) {
      const next = [...emojis, emoji];
      save(next);
    }
  };

  const removeEmoji = (idx: number) => {
    const next = emojis.filter((_, i) => i !== idx);
    save(next);
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center animate-[ctxFade_0.2s_ease]"
      style={{ background: "rgba(0,0,0,.4)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", padding: "24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "100%", maxWidth: "320px", background: "var(--bg)", color: "var(--gray-text)", borderRadius: "16px", overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "0.5px solid var(--hairline)" }}>
          <h3 style={{ margin: 0, fontSize: "var(--bubble-font-size, 16px)", fontWeight: 500 }}>이모지 프리셋</h3>
          <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", fontSize: "18px" }} onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: "12px 18px" }}>
          {/* Emoji list */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
            {emojis.map((emoji, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#f4f4f4", borderRadius: "10px" }}>
                <span style={{ color: "var(--meta)", fontSize: "var(--bubble-font-size, 14px)", marginRight: "8px" }}>☰</span>
                <span style={{ flex: 1, fontSize: "calc(var(--bubble-font-size) + 4px)" }}>{emoji}</span>
                <button style={{ background: "none", border: "none", cursor: "pointer", color: "#c0392b", fontSize: "var(--bubble-font-size, 14px)", padding: "0 4px", lineHeight: 1 }} onClick={() => removeEmoji(i)}>✕</button>
              </div>
            ))}
          </div>

          {/* Add button — opens inline emoji picker */}
          <button
            style={{ width: "100%", background: "#f4f4f4", border: "1.5px dashed #e0e0e0", borderRadius: "10px", padding: "10px", fontSize: "var(--bubble-font-size, 14px)", color: "var(--meta)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}
            onClick={() => {
              // Simple prompt for now (full emoji picker TODO)
              const emoji = prompt("이모지를 입력하세요");
              if (emoji) addEmoji(emoji);
            }}
          >
            + 추가
          </button>
        </div>
      </div>
    </div>
  );
}
