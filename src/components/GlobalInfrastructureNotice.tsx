"use client";

import { useEffect, useState } from "react";

const NOTICE_VERSION = "d1-infrastructure-2026-09-06";
const STORAGE_KEY = `globalNoticeSeen:${NOTICE_VERSION}`;

interface GlobalInfrastructureNoticeProps {
  locale: "ko" | "en";
}

const copy = {
  ko: {
    label: "서비스 안내",
    title: "서비스 이용이 일시적으로 느릴 수 있어요",
    description: "현재 서버 인프라 장애로 채널 입장과 메시지 전송이 평소보다 느리거나 일시적으로 실패할 수 있습니다.",
    detail: "문제를 확인하고 복구를 위해 대응하고 있습니다. 이용에 불편을 드려 죄송합니다.",
    confirm: "확인",
  },
  en: {
    label: "SERVICE NOTICE",
    title: "The service may be temporarily slow",
    description: "A server infrastructure issue may make channel entry and message delivery slower than usual or cause temporary failures.",
    detail: "We are investigating and working to restore normal service. We apologize for the inconvenience.",
    confirm: "OK",
  },
} as const;

export default function GlobalInfrastructureNotice({ locale }: GlobalInfrastructureNoticeProps) {
  const [visible, setVisible] = useState(false);
  const text = copy[locale];

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== "1") setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const close = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
    setVisible(false);
  };

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,.4)" }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
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
        aria-labelledby="infrastructure-notice-title"
        aria-describedby="infrastructure-notice-description"
      >
        <div className="px-6 pt-7 pb-5">
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{
              background: "color-mix(in srgb, var(--tint, #007aff) 12%, transparent)",
              color: "var(--tint, #007aff)",
            }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <div
            className="mx-auto mb-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[.08em]"
            style={{ background: "var(--card, #f2f2f7)", color: "var(--tint, #007aff)" }}
          >
            {text.label}
          </div>
          <h2 id="infrastructure-notice-title" className="m-0 text-[21px] font-bold tracking-[-.02em]">
            {text.title}
          </h2>
          <p
            id="infrastructure-notice-description"
            className="mx-auto mt-2 mb-0 max-w-[285px] text-[14px] leading-[1.55]"
            style={{ color: "var(--meta, #8e8e93)" }}
          >
            {text.description}
          </p>
        </div>

        <div className="mx-5 mb-5 rounded-[14px] px-4 py-3 text-left" style={{ background: "var(--card, #f2f2f7)" }}>
          <div className="flex items-start gap-2.5 text-[13px] leading-[1.45]">
            <svg viewBox="0 0 24 24" className="mt-[1px] h-4 w-4 shrink-0" fill="none" stroke="var(--tint, #007aff)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 7v5" />
              <path d="M12 16h.01" />
              <circle cx="12" cy="12" r="9" />
            </svg>
            <span style={{ color: "var(--secondary-text, #3c3c43)" }}>{text.detail}</span>
          </div>
        </div>

        <button
          type="button"
          className="w-full cursor-pointer border-x-0 border-b-0 bg-transparent py-[15px] text-[16px] font-semibold"
          style={{
            borderTop: "0.5px solid var(--hairline, rgba(60,60,67,.22))",
            color: "var(--tint, #007aff)",
            fontFamily: "inherit",
          }}
          onClick={close}
        >
          {text.confirm}
        </button>
      </section>
    </div>
  );
}
