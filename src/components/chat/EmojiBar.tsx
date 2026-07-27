"use client";

import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { adminAction } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";

const DEFAULT_EMOJIS = ["🍋", "🔥", "❤️", "😂", "👏", "🎉"];
const EMOJI_FX_LAYER_ID = "live-emoji-fx-layer";

interface EmojiBarProps {
  channelId: string;
  presets?: string[] | null;
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

function getEmojiFxLayer(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;

  const existing = document.getElementById(EMOJI_FX_LAYER_ID) as HTMLDivElement | null;
  if (existing) return existing;

  const layer = document.createElement("div");
  layer.id = EMOJI_FX_LAYER_ID;
  layer.style.position = "fixed";
  layer.style.inset = "0";
  layer.style.overflow = "hidden";
  layer.style.pointerEvents = "none";
  layer.style.zIndex = "1200";
  document.body.appendChild(layer);
  return layer;
}

export function EmojiBar({ channelId, presets, onBroadcast }: EmojiBarProps) {
  const [showGrid, setShowGrid] = useState(false);
  const emojis = presets && presets.length > 0 ? presets : getPresetEmojis(channelId);

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
        onClick={(e) => { e.stopPropagation(); setShowGrid(!showGrid); }}
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
  const gridRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (gridRef.current?.contains(target)) return;
      if (pickerRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler, true), 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler, true);
    };
  }, []);

  return (
    <>
      <div
        ref={gridRef}
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
            onClick={(e) => { e.stopPropagation(); onSelect(emoji); }}
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
          onClick={(e) => { e.stopPropagation(); setShowFullPicker(!showFullPicker); }}
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
            pickerRef.current = el;
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
  const layer = getEmojiFxLayer();
  if (!layer) return;

  const el = document.createElement("div");
  el.textContent = emoji;
  el.style.position = "absolute";
  el.style.bottom = "calc(68px + env(safe-area-inset-bottom))";
  el.style.left = `${x}%`;
  el.style.fontSize = "calc(var(--bubble-font-size) + 11px)";
  el.style.transform = "translate3d(-50%, 0, 0)";
  el.style.willChange = "transform, opacity";
  el.style.textShadow = "0 4px 14px rgba(0,0,0,.18)";
  el.style.pointerEvents = "none";
  el.style.setProperty("--fly-y", `-${h}vh`);
  el.style.setProperty("--fly-drift", `${(Math.random() - 0.5) * 22}vw`);
  el.style.animation = "emojiFly 1.9s cubic-bezier(.18,.72,.24,1) forwards";
  layer.appendChild(el);
  setTimeout(() => {
    el.remove();
    if (!layer.childElementCount) {
      layer.remove();
    }
  }, 1900);
}

// Emoji Preset Panel (admin, in live mode)
interface EmojiPresetPanelProps {
  channelId: string;
  onClose: () => void;
}

export function EmojiPresetPanel({ channelId, onClose }: EmojiPresetPanelProps) {
  const { t } = useLocale();
  const [emojis, setEmojis] = useState<string[]>(() => getPresetEmojis(channelId));
  const [showPicker, setShowPicker] = useState(false);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const dragDraftRef = useRef<string[] | null>(null);

  const save = (next: string[]) => {
    setEmojis(next);
    localStorage.setItem(`liveEmojis_${channelId}_live`, JSON.stringify(next));
    adminAction("set-emoji-presets", channelId, { emojis: JSON.stringify(next) });
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

  const startReorder = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragIndexRef.current = index;
    dragDraftRef.current = emojis;
    setDraggingIndex(index);
  };

  const moveReorder = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const fromIndex = dragIndexRef.current;
    if (fromIndex === null) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-emoji-index]");
    const toIndex = Number(target?.dataset.emojiIndex);
    if (!Number.isInteger(toIndex) || toIndex === fromIndex || toIndex < 0 || toIndex >= emojis.length) return;

    setEmojis((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      dragDraftRef.current = next;
      return next;
    });
    dragIndexRef.current = toIndex;
    setDraggingIndex(toIndex);
  };

  const finishReorder = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragIndexRef.current === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const next = dragDraftRef.current || emojis;
    dragIndexRef.current = null;
    dragDraftRef.current = null;
    setDraggingIndex(null);
    save(next);
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center animate-[ctxFade_0.2s_ease]"
      style={{ background: "rgba(0,0,0,.4)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", padding: "24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "100%", maxWidth: "320px", maxHeight: "80vh", background: "var(--bg)", color: "var(--gray-text)", borderRadius: "16px", overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,.25)", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "0.5px solid var(--hairline)", flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: "var(--bubble-font-size, 16px)", fontWeight: 500 }}>{ t("emojiPresets")}</h3>
          <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", fontSize: "18px" }} onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: "12px 18px", overflowY: "auto", flex: 1 }}>
          {/* Emoji list */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
            {emojis.map((emoji, i) => (
              <div
                key={emoji}
                data-emoji-index={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  background: "var(--card)",
                  borderRadius: "10px",
                  transform: draggingIndex === i ? "scale(1.02)" : "scale(1)",
                  boxShadow: draggingIndex === i ? "0 5px 16px rgba(0,0,0,.14)" : "none",
                  transition: "transform 120ms ease, box-shadow 120ms ease",
                }}
              >
                <button
                  type="button"
                  aria-label={`Move ${emoji}`}
                  style={{ appearance: "none", border: "none", background: "transparent", color: "var(--meta)", fontSize: "var(--bubble-font-size, 14px)", marginRight: "8px", padding: "4px", cursor: draggingIndex === i ? "grabbing" : "grab", touchAction: "none", userSelect: "none", lineHeight: 1 }}
                  onPointerDown={(event) => startReorder(event, i)}
                  onPointerMove={moveReorder}
                  onPointerUp={finishReorder}
                  onPointerCancel={finishReorder}
                >
                  ☰
                </button>
                <span style={{ flex: 1, fontSize: "calc(var(--bubble-font-size) + 4px)" }}>{emoji}</span>
                <button style={{ background: "none", border: "none", cursor: "pointer", color: "#c0392b", fontSize: "var(--bubble-font-size, 14px)", padding: "0 4px", lineHeight: 1 }} onClick={() => removeEmoji(i)}>✕</button>
              </div>
            ))}
          </div>

          {/* Add button — toggles emoji picker */}
          <button
            style={{ width: "100%", background: "var(--card)", border: "1.5px dashed var(--input-border)", borderRadius: "10px", padding: "10px", fontSize: "var(--bubble-font-size, 14px)", color: "var(--meta)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}
            onClick={() => setShowPicker(!showPicker)}
          >
            {showPicker ? t("closePicker") : t("add")}
          </button>

          {/* Inline emoji picker */}
          {showPicker && (
            <div
              style={{ marginTop: "12px", borderRadius: "12px", overflow: "hidden" }}
              ref={(el) => {
                if (el && !el.querySelector("emoji-picker")) {
                  import("emoji-picker-element").then(() => {
                    const picker = document.createElement("emoji-picker");
                    picker.setAttribute("locale", "ko");
                    picker.style.width = "100%";
                    picker.style.height = "280px";
                    picker.addEventListener("emoji-click", (ev: Event) => {
                      const detail = (ev as CustomEvent).detail;
                      addEmoji(detail.unicode);
                    });
                    el.appendChild(picker);
                  });
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
