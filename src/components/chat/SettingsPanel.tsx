"use client";

import { useState, useRef } from "react";
import { useLocale } from "@/hooks/useLocale";

const BUBBLE_COLORS = ["#3b8df0", "#9b59b6", "#2e7d32", "#e74c3c", "#f39c12", "#1abc9c", "#e91e63"];

function darkenColor(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
}

interface SettingsPanelProps {
  channelId: string;
  currentColor: string;
  onColorChange: (color: string) => void;
  onClose: () => void;
}

export function SettingsPanel({ channelId, currentColor, onColorChange, onClose }: SettingsPanelProps) {
  const { locale, setLocale, t } = useLocale();
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window === "undefined") return 17;
    return parseInt(localStorage.getItem("fontSize") || "17");
  });
  const [selectedColor, setSelectedColor] = useState(currentColor);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const changeFontSize = (dir: number) => {
    const newSize = Math.max(12, Math.min(20, fontSize + dir));
    setFontSize(newSize);
    localStorage.setItem("fontSize", String(newSize));
    document.documentElement.style.setProperty("--bubble-font-size", `${newSize}px`);
  };

  const changeColor = (color: string) => {
    setSelectedColor(color);
    localStorage.setItem(`bubbleColor_${channelId}`, color);
    document.documentElement.style.setProperty("--bubble-sent", color);
    onColorChange(color);
  };

  const isCustomColor = !BUBBLE_COLORS.includes(selectedColor);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-6 animate-[ctxFade_0.2s_ease]"
      style={{
        background: "rgba(0,0,0,.4)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[320px] rounded-[16px] overflow-hidden"
        style={{ background: "var(--bg)", color: "var(--gray-text)", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: "16px 18px", borderBottom: "0.5px solid var(--hairline)" }}>
          <h3 className="m-0 font-medium" style={{ fontSize: "var(--bubble-font-size, 16px)" }}>{t("settings")}</h3>
          <button
            className="bg-transparent border-none cursor-pointer"
            style={{ fontSize: "18px", color: "var(--meta)", padding: "4px 8px" }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "12px 18px" }}>
          {/* Font size */}
          <div className="flex items-start justify-between" style={{ padding: "12px 0" }}>
            <span style={{ fontSize: "var(--bubble-font-size, 15px)", fontWeight: 400 }}>{t("fontSize")}</span>
            <div className="flex items-center justify-between" style={{ gap: "10px", width: "140px" }}>
              <button
                className="cursor-pointer"
                style={{
                  width: "40px", height: "32px",
                  border: "1px solid var(--input-border)",
                  background: "var(--input-bg)",
                  color: "var(--gray-text)",
                  borderRadius: "8px",
                  fontSize: "var(--bubble-font-size, 13px)",
                  fontFamily: "inherit",
                }}
                onClick={() => changeFontSize(-1)}
              >
                A-
              </button>
              <span style={{ fontSize: "var(--bubble-font-size, 14px)", color: "var(--meta)", minWidth: "36px", textAlign: "center" }}>
                {fontSize}px
              </span>
              <button
                className="cursor-pointer"
                style={{
                  width: "40px", height: "32px",
                  border: "1px solid var(--input-border)",
                  background: "var(--input-bg)",
                  color: "var(--gray-text)",
                  borderRadius: "8px",
                  fontSize: "var(--bubble-font-size, 13px)",
                  fontFamily: "inherit",
                }}
                onClick={() => changeFontSize(1)}
              >
                A+
              </button>
            </div>
          </div>

          {/* Bubble color */}
          <div className="flex items-start justify-between" style={{ padding: "12px 0" }}>
            <span style={{ fontSize: "var(--bubble-font-size, 15px)", fontWeight: 400 }}>{t("bubbleColor")}</span>
            <div className="grid justify-items-center" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", width: "140px", padding: "2px" }}>
              {BUBBLE_COLORS.map((color) => (
                <button
                  key={color}
                  className="cursor-pointer"
                  style={{
                    width: "calc(var(--bubble-font-size, 17px) + 9px)",
                    height: "calc(var(--bubble-font-size, 17px) + 9px)",
                    borderRadius: "50%",
                    background: color,
                    border: "3px solid transparent",
                    outline: selectedColor === color ? `3px solid ${darkenColor(color, 50)}` : "3px solid transparent",
                    transition: "outline-color .15s, transform .15s",
                  }}
                  onClick={() => changeColor(color)}
                />
              ))}
              {/* Custom color picker */}
              <button
                className="cursor-pointer relative overflow-hidden"
                style={{
                  width: "calc(var(--bubble-font-size, 17px) + 9px)",
                  height: "calc(var(--bubble-font-size, 17px) + 9px)",
                  borderRadius: "50%",
                  background: "conic-gradient(red,orange,yellow,green,cyan,blue,violet,red)",
                  border: "3px solid transparent",
                  outline: isCustomColor ? `3px solid ${darkenColor(selectedColor, 50)}` : "3px solid transparent",
                  transition: "outline-color .15s, transform .15s",
                }}
              >
                <input
                  ref={colorInputRef}
                  type="color"
                  value={selectedColor}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={(e) => changeColor(e.target.value)}
                />
              </button>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: "1px", background: "var(--hairline)", margin: "8px 0" }} />

          {/* Language */}
          <div className="flex items-center justify-between" style={{ padding: "12px 0" }}>
            <span style={{ fontSize: "var(--bubble-font-size, 15px)", fontWeight: 400 }}>{t("language")}</span>
            <div className="flex" style={{ gap: "4px" }}>
              <button
                className="cursor-pointer"
                style={{
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: locale === "ko" ? `2px solid var(--bubble-sent)` : "2px solid var(--input-border)",
                  background: locale === "ko" ? "color-mix(in srgb, var(--bubble-sent) 10%, transparent)" : "var(--input-bg)",
                  color: locale === "ko" ? "var(--bubble-sent)" : "var(--gray-text)",
                  fontSize: "calc(var(--bubble-font-size) - 3px)",
                  fontFamily: "inherit",
                  fontWeight: locale === "ko" ? 600 : 400,
                  lineHeight: 1,
                }}
                onClick={() => setLocale("ko")}
              >
                한국어
              </button>
              <button
                className="cursor-pointer"
                style={{
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: locale === "en" ? `2px solid var(--bubble-sent)` : "2px solid var(--input-border)",
                  background: locale === "en" ? "color-mix(in srgb, var(--bubble-sent) 10%, transparent)" : "var(--input-bg)",
                  color: locale === "en" ? "var(--bubble-sent)" : "var(--gray-text)",
                  fontSize: "calc(var(--bubble-font-size) - 3px)",
                  fontFamily: "inherit",
                  fontWeight: locale === "en" ? 600 : 400,
                  lineHeight: 1,
                }}
                onClick={() => setLocale("en")}
              >
                English
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
