"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/useLocale";

interface DashboardHelpMenuProps {
  isLoggedIn: boolean;
  onOpenAdminGuide: () => void;
  onOpenSupport: () => void;
  onOpenUserGuide: () => void;
}

export function DashboardHelpMenu({
  isLoggedIn,
  onOpenAdminGuide,
  onOpenSupport,
  onOpenUserGuide,
}: DashboardHelpMenuProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", closeOnOutsideClick);
    return () => document.removeEventListener("click", closeOnOutsideClick);
  }, [open]);

  const openUserGuide = () => {
    setOpen(false);
    onOpenUserGuide();
  };

  const openSupport = () => {
    setOpen(false);
    onOpenSupport();
  };

  const openAdminGuide = () => {
    setOpen(false);
    onOpenAdminGuide();
  };

  return (
    <div
      ref={containerRef}
      className="fixed z-40"
      style={{
        left: "max(20px, calc((100vw - 480px) / 2 + 20px))",
        bottom: "max(20px, env(safe-area-inset-bottom))",
      }}
    >
      {open && (
        <div
          className="absolute left-0 min-w-[180px] overflow-hidden rounded-[14px]"
          style={{
            bottom: "52px",
            background: "var(--header-bg)",
            boxShadow: "0 10px 30px rgba(15,23,42,.16)",
            backdropFilter: "saturate(180%) blur(20px)",
            WebkitBackdropFilter: "saturate(180%) blur(20px)",
          }}
        >
          <button className="w-full border-none cursor-pointer text-left px-4 py-3 text-[14px]" style={{ background: "transparent", color: "var(--tint)", borderBottom: "0.5px solid var(--hairline)" }} onClick={openUserGuide}>{t("userGuide")}</button>
          <button className="w-full border-none cursor-pointer text-left px-4 py-3 text-[14px]" style={{ background: "transparent", color: "var(--tint)", borderBottom: isLoggedIn ? "0.5px solid var(--hairline)" : "none" }} onClick={openSupport}>{t("supportMenu")}</button>
          {isLoggedIn && (
            <>
              <button className="w-full border-none cursor-pointer text-left px-4 py-3 text-[14px]" style={{ background: "transparent", color: "var(--tint)" }} onClick={openAdminGuide}>{t("guide")}</button>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        aria-expanded={open}
        aria-label={t("dashboardHelp")}
        className="flex h-11 w-11 items-center justify-center rounded-full border-none"
        style={{
          background: open ? "rgba(0,122,255,.88)" : "rgba(255,255,255,.9)",
          color: open ? "#fff" : "var(--tint)",
          boxShadow: "0 12px 24px rgba(15,23,42,.14)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          cursor: "pointer",
        }}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.5 9.5a2.5 2.5 0 1 1 4 2c-.9.6-1.5 1.1-1.5 2.5" />
          <circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </button>
    </div>
  );
}
