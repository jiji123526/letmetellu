"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "@/hooks/useLocale";

interface HeaderMenuProps {
  anchorRect: DOMRect;
  onSettings: () => void;
  onGallery: () => void;
  onLinks: () => void;
  onAdmin?: () => void;
  onClose: () => void;
}

export function HeaderMenu({ anchorRect, onSettings, onGallery, onLinks, onAdmin, onClose }: HeaderMenuProps) {
  const { t } = useLocale();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener("click", handler), 10);
    return () => document.removeEventListener("click", handler);
  }, [onClose]);

  const handlers: Record<string, () => void> = {
    settings: onSettings,
    gallery: onGallery,
    links: onLinks,
    ...(onAdmin ? { admin: onAdmin } : {}),
  };

  const items = [
    { key: "settings", label: t("settings"), icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" stroke-width="2"/></svg>` },
    { key: "gallery", label: t("gallery"), icon: `<svg viewBox="0 0 24 24" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
    { key: "links", label: t("links"), icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>` },
    ...(onAdmin ? [{ key: "admin", label: t("adminSettings"), icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" fill="none" stroke="currentColor" stroke-width="2"/></svg>` }] : []),
  ];

  return (
    <div
      ref={menuRef}
      className="header-menu-container"
      style={{
        position: "fixed",
        zIndex: 80,
        top: anchorRect.bottom + 6,
        right: window.innerWidth - anchorRect.right,
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: "0 4px 20px rgba(0,0,0,.15)",
        minWidth: "140px",
        animation: "ctxPop .15s ease",
        background: "var(--header-bg)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
      }}
    >
      {items.map((item, i) => (
        <button
          key={item.key}
          className="header-menu-item"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            width: "100%",
            border: "none",
            background: "none",
            color: "var(--gray-text)",
            fontSize: "var(--bubble-font-size, 17px)",
            fontFamily: "inherit",
            padding: "12px 16px",
            textAlign: "left" as const,
            cursor: "pointer",
            borderBottom: i < items.length - 1 ? "0.5px solid var(--hairline)" : "none",
            lineHeight: 1,
          }}
          onClick={() => { handlers[item.key](); onClose(); }}
        >
          <span
            className="flex-shrink-0"
            dangerouslySetInnerHTML={{ __html: item.icon }}
          />
          {item.label}
        </button>
      ))}
    </div>
  );
}
