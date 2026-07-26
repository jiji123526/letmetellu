"use client";

import { useState } from "react";
import { useLocale } from "@/hooks/useLocale";

interface GuestOnboardingProps {
  onClose: () => void;
}

const introIcons = ["↗", "lock", "◉"];
const guideIcons = ["1", "2", "3"];

export function GuestOnboarding({ onClose }: GuestOnboardingProps) {
  const { t } = useLocale();
  const [step, setStep] = useState<"intro" | "guide">("intro");
  const cards = step === "intro"
    ? [
        [t("guestOnboardingAnonymousTitle"), t("guestOnboardingAnonymousDesc")],
        [t("guestOnboardingAccessTitle"), t("guestOnboardingAccessDesc")],
        [t("guestOnboardingLiveTitle"), t("guestOnboardingLiveDesc")],
      ]
    : [
        [t("guestOnboardingOpenTitle"), t("guestOnboardingOpenDesc")],
        [t("guestOnboardingRecentTitle"), t("guestOnboardingRecentDesc")],
        [t("guestOnboardingReturnTitle"), t("guestOnboardingReturnDesc")],
      ];
  const icons = step === "intro" ? introIcons : guideIcons;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,.35)", backdropFilter: "blur(5px)" }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-[420px] max-h-[calc(100dvh-32px)] overflow-hidden rounded-[24px] flex flex-col" style={{ background: "#fff", boxShadow: "0 24px 70px rgba(0,0,0,.22)" }}>
        <header className="px-5 pt-4 pb-3 flex items-center justify-between border-b" style={{ borderColor: "#e5e5ea" }}>
          <button type="button" className="min-w-[54px] border-none bg-transparent text-left text-[15px] cursor-pointer" style={{ color: "#007aff" }} onClick={onClose}>
            {t("close")}
          </button>
          <div className="flex gap-1.5" aria-label={step === "intro" ? "1/2" : "2/2"}>
            {[0, 1].map((index) => <span key={index} className="w-1.5 h-1.5 rounded-full" style={{ background: index === (step === "intro" ? 0 : 1) ? "#007aff" : "#d1d1d6" }} />)}
          </div>
          <span className="min-w-[54px] text-right text-[12px]" style={{ color: "#8e8e93" }}>{step === "intro" ? "1/2" : "2/2"}</span>
        </header>

        <div className="min-h-0 overflow-y-auto px-6 py-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-[28px] font-semibold" style={{ background: "#eaf3ff", color: "#007aff" }}>
              {step === "intro" ? "…" : "✓"}
            </div>
            <h2 className="m-0 text-[24px] font-bold tracking-[-.02em]">{t(step === "intro" ? "guestOnboardingTitle" : "guestOnboardingGuideTitle")}</h2>
            <p className="mt-2 mb-0 text-[14px] leading-[1.5]" style={{ color: "#8e8e93" }}>{t(step === "intro" ? "guestOnboardingDesc" : "guestOnboardingGuideDesc")}</p>
          </div>

          <div className="rounded-[16px] overflow-hidden" style={{ background: "#f7f7f9" }}>
            {cards.map(([title, description], index) => (
              <div key={title} className="flex gap-3 px-4 py-4" style={{ borderBottom: index < cards.length - 1 ? "0.5px solid #dedee3" : "none" }}>
                <span className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-[17px] font-semibold" style={{ background: "#eaf3ff", color: "#007aff" }}>
                  {icons[index] === "lock" ? (
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="5" y="10" width="14" height="10" rx="2.5" />
                      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
                    </svg>
                  ) : icons[index]}
                </span>
                <div className="min-w-0">
                  <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
                  <p className="mt-1 mb-0 text-[13px] leading-[1.45]" style={{ color: "#6d6d72" }}>{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="px-5 py-4 border-t" style={{ borderColor: "#e5e5ea", background: "rgba(255,255,255,.96)" }}>
          {step === "intro" ? (
            <button className="w-full border-none rounded-[12px] py-3 text-white text-[15px] font-semibold cursor-pointer" style={{ background: "#007aff" }} onClick={() => setStep("guide")}>
              {t("guestOnboardingNext")}
            </button>
          ) : (
            <button className="w-full border-none rounded-[12px] py-3 text-white text-[15px] font-semibold cursor-pointer" style={{ background: "#007aff" }} onClick={onClose}>
              {t("guestOnboardingDone")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
