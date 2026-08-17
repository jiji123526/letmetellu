"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";

const STORAGE_KEY = "yap_product_update_private_dm_replies_v1_seen";

export function ProductUpdateDialog() {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (localStorage.getItem(STORAGE_KEY) === "true") return;
        localStorage.setItem(STORAGE_KEY, "true");
      } catch {
        // Storage-disabled browsers still receive the announcement this visit.
      }
      setVisible(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[650] flex items-center justify-center px-5"
      style={{
        background: "rgba(0,0,0,.42)",
        backdropFilter: "blur(5px)",
        WebkitBackdropFilter: "blur(5px)",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) setVisible(false);
      }}
      role="presentation"
    >
      <section
        className="w-full max-w-[360px] overflow-hidden"
        style={{
          background: "var(--bg, #fff)",
          border: "0.5px solid var(--hairline, rgba(60,60,67,.22))",
          borderRadius: "24px",
          boxShadow: "0 24px 70px rgba(0,0,0,.24)",
          color: "var(--gray-text, #111)",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-update-title"
      >
        <div className="px-6 pt-7 pb-5 text-center">
          <div
            className="relative mx-auto mb-4 flex h-[68px] w-[68px] items-center justify-center rounded-[22px]"
            style={{
              background: "color-mix(in srgb, var(--tint, #007aff) 12%, var(--bg, #fff))",
              color: "var(--tint, #007aff)",
            }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 32 32" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 7.5h22v14H12l-7 5v-19Z" />
              <path d="M11 12h10M11 17h7" />
            </svg>
            <span
              className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 text-[12px] font-bold"
              style={{ background: "var(--tint, #007aff)", borderColor: "var(--bg, #fff)", color: "#fff" }}
            >
              1
            </span>
          </div>
          <div
            className="mb-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[.1em]"
            style={{
              background: "var(--card, #f2f2f7)",
              color: "var(--tint, #007aff)",
            }}
          >
            {t("productUpdateEyebrow")}
          </div>
          <h2 id="product-update-title" className="m-0 text-[22px] font-bold tracking-[-.025em]">
            {t("productUpdateTitle")}
          </h2>
          <p className="mx-auto mt-2 mb-0 max-w-[290px] text-[14px] leading-[1.55]" style={{ color: "var(--meta, #8e8e93)" }}>
            {t("productUpdateDescription")}
          </p>
        </div>

        <div className="mx-5 mb-5 overflow-hidden rounded-[16px]" style={{ background: "var(--card, #f2f2f7)" }}>
          {[
            ["eye", t("productUpdateHistory")],
            ["lock", t("productUpdatePrivacy")],
            ["arrow", t("productUpdateReply")],
          ].map(([icon, text], index) => (
            <div
              key={icon}
              className="flex items-center gap-3 px-4 py-3.5 text-[13px] leading-[1.45]"
              style={{
                borderTop: index === 0 ? "none" : "0.5px solid var(--hairline, rgba(60,60,67,.18))",
                color: "var(--secondary-text, #3c3c43)",
              }}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: "color-mix(in srgb, var(--tint, #007aff) 12%, transparent)",
                  color: "var(--tint, #007aff)",
                }}
                aria-hidden="true"
              >
                {icon === "eye" ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>
                ) : icon === "lock" ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 7-5 5 5 5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg>
                )}
              </span>
              <span>{text}</span>
            </div>
          ))}
        </div>

        <button
          type="button"
          autoFocus
          className="w-full cursor-pointer border-x-0 border-b-0 bg-transparent py-[15px] text-[16px] font-semibold"
          style={{
            borderTop: "0.5px solid var(--hairline, rgba(60,60,67,.22))",
            color: "var(--tint, #007aff)",
            fontFamily: "inherit",
          }}
          onClick={() => setVisible(false)}
        >
          {t("productUpdateConfirm")}
        </button>
      </section>
    </div>
  );
}
