"use client";

import { useState, useEffect, useMemo } from "react";
import { useLocale } from "@/hooks/useLocale";

interface WelcomeConfig {
  icon: string;
  title: string;
  items: string[];
}

export function WelcomePopup({ channelId, bubbleColor, customConfig }: { channelId: string; bubbleColor?: string; customConfig?: string }) {
  const { t } = useLocale();
  const [show, setShow] = useState(false);
  const config = useMemo<WelcomeConfig | null>(() => {
    if (!customConfig) return null;
    try {
      const parsed = JSON.parse(customConfig);
      if (!parsed.title) return null;
      const parsedIcon = typeof parsed.icon === "string" ? parsed.icon : "";
      return {
        icon: parsedIcon && !parsedIcon.startsWith("blob:") && !parsedIcon.startsWith("data:")
          ? parsedIcon
          : "💬",
        title: parsed.title,
        items: Array.isArray(parsed.items)
          ? parsed.items.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
          : [],
      };
    } catch {
      return null;
    }
  }, [customConfig]);

  useEffect(() => {
    if (!config || !customConfig) {
      setShow(false);
      return;
    }
    const key = `welcome_seen_${channelId}`;
    if (localStorage.getItem(key) !== customConfig) {
      localStorage.setItem(key, customConfig);
      setShow(true);
    }
  }, [channelId, config, customConfig]);

  if (!show || !config) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) setShow(false); }}
    >
      <div className="w-full max-w-[320px] rounded-[20px] p-7 text-center" style={{ background: "var(--bg)", color: "var(--gray-text)", border: `2px solid ${bubbleColor || "var(--bubble-sent, #3b8df0)"}`, boxShadow: "0 12px 40px rgba(0,0,0,.15)" }}>
        <div className="text-[40px] mb-3">
          {config.icon.startsWith("http")
            ? <img src={config.icon} alt="" style={{ width: "64px", height: "64px", borderRadius: "16px", objectFit: "cover", margin: "0 auto" }} />
            : config.icon
          }
        </div>
        <div className="text-[19px] font-bold mb-4">{config.title}</div>
        <ul className="text-left flex flex-col gap-[10px] mb-5 list-none p-0">
          {config.items.map((text, i) => (
            <li key={i} className="text-[13px] leading-[1.5] pl-4 relative" style={{ color: "var(--gray-text)" }}>
              <span className="absolute left-0" style={{ color: "var(--meta)" }}>•</span>
              {text}
            </li>
          ))}
        </ul>
        <button
          className="w-full py-3 border-none rounded-[12px] text-white text-[15px] font-semibold cursor-pointer"
          style={{ background: bubbleColor || "var(--bubble-sent)", lineHeight: 1 }}
          onClick={() => setShow(false)}
        >
          {t("welcomeConfirm")}
        </button>
      </div>
    </div>
  );
}
