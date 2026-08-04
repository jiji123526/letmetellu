"use client";

import { useLocale } from "@/hooks/useLocale";

interface BetaNoticeDialogProps {
  onClose: () => void;
}

export function BetaNoticeDialog({ onClose }: BetaNoticeDialogProps) {
  const { t } = useLocale();

  return (
    <div
      className="fixed inset-0 z-[290] flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,.4)" }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        className="w-full max-w-[340px] overflow-hidden text-center"
        style={{
          background: "var(--bg, #fff)",
          borderRadius: "22px",
          boxShadow: "0 18px 50px rgba(0,0,0,.22)",
          color: "var(--gray-text, #111)",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="beta-notice-title"
      >
        <div className="px-6 pt-7 pb-5">
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: "color-mix(in srgb, var(--tint, #007aff) 12%, transparent)", color: "var(--tint, #007aff)" }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3h8" />
              <path d="M10 3v5.2l-4.7 8.1A3.1 3.1 0 0 0 8 21h8a3.1 3.1 0 0 0 2.7-4.7L14 8.2V3" />
              <path d="M7.7 14h8.6" />
              <circle cx="10" cy="17" r=".7" fill="currentColor" stroke="none" />
              <circle cx="14" cy="18.2" r=".7" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div
            className="mx-auto mb-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[.08em]"
            style={{ background: "var(--card, #f2f2f7)", color: "var(--tint, #007aff)" }}
          >
            BETA
          </div>
          <h2 id="beta-notice-title" className="m-0 text-[21px] font-bold tracking-[-.02em]">
            {t("betaNoticeTitle")}
          </h2>
          <p className="mx-auto mt-2 mb-0 max-w-[270px] text-[14px] leading-[1.55]" style={{ color: "var(--meta, #8e8e93)" }}>
            {t("betaNoticeDescription")}
          </p>
        </div>

        <div className="mx-5 mb-5 rounded-[14px] px-4 py-3 text-left" style={{ background: "var(--card, #f2f2f7)" }}>
          <div className="flex items-start gap-2.5 text-[13px] leading-[1.45]">
            <svg viewBox="0 0 24 24" className="mt-[1px] h-4 w-4 shrink-0" fill="none" stroke="var(--tint, #007aff)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 8v4M12 16h.01" />
              <circle cx="12" cy="12" r="9" />
            </svg>
            <span style={{ color: "var(--secondary-text, #3c3c43)" }}>{t("betaNoticeDetail")}</span>
          </div>
        </div>

        <button
          type="button"
          className="w-full border-x-0 border-b-0 bg-transparent py-[15px] text-[16px] font-semibold cursor-pointer"
          style={{ borderTop: "0.5px solid var(--hairline, rgba(60,60,67,.22))", color: "var(--tint, #007aff)", fontFamily: "inherit" }}
          onClick={onClose}
        >
          {t("betaNoticeConfirm")}
        </button>
      </section>
    </div>
  );
}
