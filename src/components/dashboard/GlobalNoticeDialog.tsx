"use client";

import type { ReactNode } from "react";
import { useLocale } from "@/hooks/useLocale";
import type { GlobalNotice } from "@/lib/api-global-notice";

interface GlobalNoticeSurfaceProps {
  footer: ReactNode;
  notice: GlobalNotice;
  titleId?: string;
}

interface GlobalNoticeDialogProps {
  notice: GlobalNotice;
  onClose: () => void;
}

export function GlobalNoticeSurface({
  footer,
  notice,
  titleId = "global-notice-title",
}: GlobalNoticeSurfaceProps) {
  const { t } = useLocale();

  return (
    <section
      className="w-full max-w-[360px] overflow-hidden"
      style={{
        background: "var(--bg, #fff)",
        borderRadius: "22px",
        boxShadow: "0 18px 50px rgba(0,0,0,.22)",
        color: "var(--gray-text, #111)",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="px-6 pt-7 pb-5 text-center">
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: "color-mix(in srgb, var(--tint, #007aff) 12%, transparent)", color: "var(--tint, #007aff)" }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" />
            <circle cx="12" cy="16.5" r=".9" fill="currentColor" stroke="none" />
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </div>
        <div
          className="mx-auto mb-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[.08em]"
          style={{ background: "var(--card, #f2f2f7)", color: "var(--tint, #007aff)" }}
        >
          {t("globalNoticeBadge")}
        </div>
        <h2 id={titleId} className="m-0 text-[21px] font-bold tracking-[-.02em]">
          {notice.title}
        </h2>
        {notice.body && (
          <p
            className="mx-auto mt-3 mb-0 max-w-[280px] whitespace-pre-wrap text-[14px] leading-[1.6]"
            style={{ color: "var(--meta, #8e8e93)" }}
          >
            {notice.body}
          </p>
        )}
      </div>

      {footer}
    </section>
  );
}

export function GlobalNoticeDialog({ notice, onClose }: GlobalNoticeDialogProps) {
  const { t } = useLocale();

  return (
    <div
      className="fixed inset-0 z-[650] flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,.4)" }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <GlobalNoticeSurface
        notice={notice}
        footer={(
          <button
            type="button"
            className="w-full border-x-0 border-b-0 bg-transparent py-[15px] text-[16px] font-semibold cursor-pointer"
            style={{ borderTop: "0.5px solid var(--hairline, rgba(60,60,67,.22))", color: "var(--tint, #007aff)", fontFamily: "inherit" }}
            onClick={onClose}
          >
            {t("globalNoticeConfirm")}
          </button>
        )}
      />
    </div>
  );
}
