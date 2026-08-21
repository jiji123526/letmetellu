"use client";

import { CloseIcon } from "@/components/ui/CloseIcon";
import { useEffect, useState, useRef } from "react";
import { useLocale } from "@/hooks/useLocale";
import { useSession } from "next-auth/react";
import { saveFontSize } from "@/components/UserPreferencesSync";
import { normalizeBubbleColor } from "@/lib/bubble-color";

const BUBBLE_COLORS = ["#3598fe", "#9b59b6", "#2e7d32", "#e74c3c", "#f39c12", "#1abc9c", "#e91e63"];

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
  personalBubbleColorEnabled: boolean;
  onColorChange: (color: string) => void;
  onAdmin?: () => void;
  onClose: () => void;
}

export function SettingsPanel({
  channelId,
  currentColor,
  personalBubbleColorEnabled,
  onColorChange,
  onAdmin,
  onClose,
}: SettingsPanelProps) {
  const { locale, setLocale, t } = useLocale();
  const { status } = useSession();
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window === "undefined") return 15;
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue("--bubble-font-size")) || 15;
  });
  const [selectedColor, setSelectedColor] = useState(currentColor);
  const colorInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleFontSize = (event: Event) => {
      const size = (event as CustomEvent<{ size: number }>).detail?.size;
      if (size) setFontSize(size);
    };
    window.addEventListener("font-size-changed", handleFontSize);
    return () => window.removeEventListener("font-size-changed", handleFontSize);
  }, []);

  const changeFontSize = (dir: number) => {
    const newSize = Math.max(12, Math.min(20, fontSize + dir));
    setFontSize(newSize);
    void saveFontSize(newSize, status === "authenticated");
  };

  const changeColor = (color: string) => {
    if (!personalBubbleColorEnabled) return;
    const normalizedColor = normalizeBubbleColor(color);
    setSelectedColor(normalizedColor);
    localStorage.setItem(`bubbleColor_${channelId}`, normalizedColor);
    document.documentElement.style.setProperty("--bubble-sent", normalizedColor);
    onColorChange(normalizedColor);
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
            style={{ color: "var(--meta)", padding: "4px 8px" }}
            onClick={onClose}
          >
            <CloseIcon />
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
            <span className="flex items-center gap-1.5" style={{ fontSize: "var(--bubble-font-size, 15px)", fontWeight: 400 }}>
              {t("bubbleColor")}
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: "#fff5d6", color: "#9a6700", lineHeight: 1.2 }}
              >
                {t("plusBadge")}
              </span>
            </span>
            <div
              className="grid justify-items-center"
              style={{
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "6px",
                width: "140px",
                padding: "2px",
                opacity: personalBubbleColorEnabled ? 1 : 0.42,
              }}
            >
              {BUBBLE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  disabled={!personalBubbleColorEnabled}
                  className={personalBubbleColorEnabled ? "cursor-pointer" : "cursor-default"}
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
                type="button"
                disabled={!personalBubbleColorEnabled}
                className={`${personalBubbleColorEnabled ? "cursor-pointer" : "cursor-default"} relative overflow-hidden`}
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
                  disabled={!personalBubbleColorEnabled}
                  className={`absolute inset-0 w-full h-full opacity-0 ${personalBubbleColorEnabled ? "cursor-pointer" : "cursor-default"}`}
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
            <div className="flex" style={{ gap: "4px", width: "140px" }}>
              <button
                className="cursor-pointer"
                style={{
                  padding: "6px 0",
                  flex: 1,
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
                  padding: "6px 0",
                  flex: 1,
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

          {onAdmin && (
            <>
              <div style={{ height: "1px", background: "var(--hairline)", margin: "8px 0" }} />
              <button
                type="button"
                className="w-full border-none bg-transparent cursor-pointer flex items-center justify-between"
                style={{ padding: "12px 0", color: "var(--gray-text)", fontFamily: "inherit" }}
                onClick={onAdmin}
              >
                <span className="flex items-center gap-2.5" style={{ fontSize: "var(--bubble-font-size, 15px)" }}>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M12 2 3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                  {t("adminSettings")}
                </span>
                <span style={{ color: "var(--meta)", fontSize: "20px", lineHeight: 1 }}>›</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
