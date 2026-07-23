"use client";

import { useState, useEffect, useCallback } from "react";

const PRESET_EMOJIS = ["🍋", "🔥", "❤️", "😂", "👏", "🎉"];

interface EmojiBarProps {
  onBroadcast: (emoji: string, x: number, h: number) => void;
}

export function EmojiBar({ onBroadcast }: EmojiBarProps) {
  const [showGrid, setShowGrid] = useState(false);

  const triggerEmoji = (emoji: string) => {
    const x = 30 + Math.random() * 40;
    const h = 65 + Math.random() * 25;
    spawnEmoji(emoji, x, h);
    onBroadcast(emoji, x, h);
    setShowGrid(false);
  };

  return (
    <>
      {/* Trigger button (inside composer area) */}
      <button
        style={{ border: "none", background: "none", fontSize: "var(--bubble-font-size)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: "4px 6px", marginRight: "4px", lineHeight: 1, zIndex: 2 }}
        onClick={() => setShowGrid(!showGrid)}
      >
        {PRESET_EMOJIS[0]}
      </button>

      {/* Emoji grid popup */}
      {showGrid && (
        <EmojiGrid
          emojis={PRESET_EMOJIS}
          onSelect={triggerEmoji}
          onClose={() => setShowGrid(false)}
        />
      )}
    </>
  );
}

function EmojiGrid({ emojis, onSelect, onClose }: { emojis: string[]; onSelect: (emoji: string) => void; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".emoji-fx-grid-container") && !target.closest(".emoji-fx-trigger")) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener("click", handler), 10);
    return () => document.removeEventListener("click", handler);
  }, [onClose]);

  return (
    <div
      className="emoji-fx-grid-container"
      style={{
        position: "fixed",
        bottom: "70px",
        right: "12px",
        display: "flex",
        background: "rgba(255,255,255,.85)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        borderRadius: "22px",
        padding: "6px 8px",
        boxShadow: "0 4px 20px rgba(0,0,0,.15)",
        zIndex: 300,
      }}
    >
      <div style={{ display: "flex", gap: "2px" }}>
        {emojis.map((emoji) => (
          <button
            key={emoji}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "calc(var(--bubble-font-size) + 2px)", padding: "4px", lineHeight: 1, borderRadius: "8px", transition: "transform .1s" }}
            onClick={() => onSelect(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

// Spawn a floating emoji animation
export function spawnEmoji(emoji: string, x: number, h: number) {
  const el = document.createElement("div");
  el.className = "emoji-fx";
  el.textContent = emoji;
  el.style.left = `${x}%`;
  el.style.setProperty("--fly-h", `${h}vh`);
  el.style.position = "fixed";
  el.style.bottom = "0";
  el.style.fontSize = "28px";
  el.style.zIndex = "999";
  el.style.pointerEvents = "none";
  el.style.animation = "emojiFly 2s ease-out forwards";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}
