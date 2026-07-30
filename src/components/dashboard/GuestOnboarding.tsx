"use client";

import Image from "next/image";
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocale } from "@/hooks/useLocale";

interface GuestOnboardingProps {
  onClose: () => void;
}

const introIcons = ["↗", "lock", "◉"];
const guideIcons = ["1", "2", "3"];

export function GuestOnboarding({ onClose }: GuestOnboardingProps) {
  const { t } = useLocale();
  const [step, setStep] = useState<"intro" | "guide">("intro");
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const horizontalDrag = useRef(false);
  const slideRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLElement | null>>([]);
  const pages = [
    {
      step: "intro" as const,
      icon: <Image src="/logo.svg" alt="" width={36} height={36} className="block h-9 w-9" />,
      title: t("guestOnboardingTitle"),
      description: t("guestOnboardingDesc"),
      cards: [
        [t("guestOnboardingAnonymousTitle"), t("guestOnboardingAnonymousDesc")],
        [t("guestOnboardingAccessTitle"), t("guestOnboardingAccessDesc")],
        [t("guestOnboardingLiveTitle"), t("guestOnboardingLiveDesc")],
      ],
      icons: introIcons,
    },
    {
      step: "guide" as const,
      icon: "✓",
      title: t("guestOnboardingGuideTitle"),
      description: t("guestOnboardingGuideDesc"),
      cards: [
        [t("guestOnboardingOpenTitle"), t("guestOnboardingOpenDesc")],
        [t("guestOnboardingRecentTitle"), t("guestOnboardingRecentDesc")],
        [t("guestOnboardingReturnTitle"), t("guestOnboardingReturnDesc")],
      ],
      icons: guideIcons,
    },
  ];

  const finishSwipe = (nextStep: "intro" | "guide") => {
    setDragging(false);
    setStep(nextStep);
    setDragX(0);
  };

  const activePageIndex = step === "intro" ? 0 : 1;

  useLayoutEffect(() => {
    const pageEl = pageRefs.current[activePageIndex];
    if (!pageEl) return;

    const updateHeight = () => setContentHeight(pageEl.offsetHeight);
    updateHeight();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(pageEl);
    return () => observer.disconnect();
  }, [activePageIndex]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
    horizontalDrag.current = false;
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const dx = event.clientX - dragStart.current.x;
    const dy = event.clientY - dragStart.current.y;
    if (!horizontalDrag.current) {
      if (Math.abs(dx) < 7) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        dragStart.current = null;
        setDragging(false);
        return;
      }
      horizontalDrag.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const isBlockedDirection = (step === "intro" && dx > 0) || (step === "guide" && dx < 0);
    setDragX(isBlockedDirection ? dx * 0.18 : dx);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dx = dragX;
    dragStart.current = null;
    horizontalDrag.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (step === "intro" && dx < -60) {
      finishSwipe("guide");
    } else if (step === "guide" && dx > 60) {
      finishSwipe("intro");
    } else {
      setDragging(false);
      setDragX(0);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,.35)", backdropFilter: "blur(5px)" }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-[420px] max-h-[calc(100dvh-32px)] overflow-hidden rounded-[24px] flex flex-col" style={{ background: "var(--bg)", color: "var(--gray-text)", boxShadow: "0 24px 70px rgba(0,0,0,.22)" }}>
        <header className="px-5 pt-4 pb-3 flex items-center justify-between border-b" style={{ borderColor: "var(--hairline)" }}>
          <button type="button" className="min-w-[54px] border-none bg-transparent text-left text-[15px] cursor-pointer" style={{ color: "#007aff" }} onClick={onClose}>
            {t("close")}
          </button>
          <div className="flex gap-1.5" aria-label={step === "intro" ? "1/2" : "2/2"}>
            {[0, 1].map((index) => <span key={index} className="w-1.5 h-1.5 rounded-full" style={{ background: index === (step === "intro" ? 0 : 1) ? "#007aff" : "#d1d1d6" }} />)}
          </div>
          {step === "guide" ? (
            <button
              type="button"
              className="min-w-[54px] border-none bg-transparent p-0 text-right text-[15px] cursor-pointer"
              style={{ color: "#007aff" }}
              onClick={onClose}
            >
              {t("guestOnboardingDone")}
            </button>
          ) : (
            <span className="min-w-[54px]" aria-hidden="true" />
          )}
        </header>

        <div
          ref={slideRef}
          className="onboarding-scroll min-h-0 overflow-x-hidden overflow-y-auto"
          style={{
            touchAction: "pan-y",
            height: contentHeight ? `${contentHeight}px` : undefined,
            transition: dragging ? "none" : "height 220ms cubic-bezier(.22,.61,.36,1)",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <div
            className="flex items-start w-[200%]"
            style={{
              height: contentHeight ? `${contentHeight}px` : undefined,
              overflow: "hidden",
              transform: `translateX(calc(${step === "guide" ? "-50%" : "0%"} + ${dragX}px))`,
              transition: dragging ? "none" : "transform 220ms cubic-bezier(.22,.61,.36,1)",
            }}
          >
            {pages.map((page, index) => (
              <section
                key={page.step}
                ref={(node) => { pageRefs.current[index] = node; }}
                className="w-1/2 flex-none px-6 py-6"
                aria-hidden={step !== page.step}
              >
                <div className="text-center mb-6">
                  <div
                    className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center font-semibold ${page.step === "intro" ? "text-[20px] tracking-[-.03em]" : "text-[28px]"}`}
                    style={{ background: "#eaf3ff", color: "#007aff" }}
                  >
                    {page.icon}
                  </div>
                  <h2 className="m-0 text-[24px] font-bold tracking-[-.02em]">{page.title}</h2>
                  <p className="mt-2 mb-0 text-[14px] leading-[1.5]" style={{ color: "var(--meta)" }}>{page.description}</p>
                </div>

                <div className="rounded-[16px] overflow-hidden" style={{ background: "var(--card)" }}>
                  {page.cards.map(([title, description], index) => (
                    <div key={title} className="flex gap-3 px-4 py-4" style={{ borderBottom: index < page.cards.length - 1 ? "0.5px solid #dedee3" : "none" }}>
                      <span className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-[17px] font-semibold" style={{ background: "#eaf3ff", color: "#007aff" }}>
                        {page.icons[index] === "lock" ? (
                          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="5" y="10" width="14" height="10" rx="2.5" />
                            <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
                          </svg>
                        ) : page.icons[index]}
                      </span>
                      <div className="min-w-0">
                        <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
                        <p className="mt-1 mb-0 text-[13px] leading-[1.45]" style={{ color: "var(--secondary-text)" }}>{description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
