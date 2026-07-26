"use client";

import { useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { clearChannelLocalState } from "@/lib/channel-local-state";

type OnboardingStep = "features" | "create" | "guide";

interface FirstChannelOnboardingProps {
  onCreated: (channelId: string) => Promise<void>;
  onClose: () => void;
}

const featureIcons = [
  { icon: "↗", color: "#eaf3ff" },
  { icon: "✉", color: "#f0edff" },
  { icon: "◉", color: "#fff0ea" },
  { icon: "❄", color: "#edf7ff" },
];

const guideIcons = ["↗", "☺", "⌨", "✉", "❄", "◉", "!", "⊘", "⚑"];

export function FirstChannelOnboarding({ onCreated, onClose }: FirstChannelOnboardingProps) {
  const { t } = useLocale();
  const [step, setStep] = useState<OnboardingStep>("features");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [createdChannelId, setCreatedChannelId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const stepIndex = step === "features" ? 0 : step === "create" ? 1 : 2;
  const features = [
    [t("firstOnboardingPrivateTitle"), t("firstOnboardingPrivateDesc")],
    [t("firstOnboardingDmTitle"), t("firstOnboardingDmDesc")],
    [t("firstOnboardingLiveTitle"), t("firstOnboardingLiveDesc")],
    [t("firstOnboardingControlTitle"), t("firstOnboardingControlDesc")],
  ];
  const guides = [
    [t("firstGuideInviteTitle"), t("firstGuideInviteDesc")],
    [t("firstGuideWelcomeTitle"), t("firstGuideWelcomeDesc")],
    [t("firstGuidePasscodeTitle"), t("firstGuidePasscodeDesc")],
    [t("firstGuideDmTitle"), t("firstGuideDmDesc")],
    [t("firstGuideFreezeTitle"), t("firstGuideFreezeDesc")],
    [t("firstGuideLiveTitle"), t("firstGuideLiveDesc")],
    [t("firstGuideNoticeTitle"), t("firstGuideNoticeDesc")],
    [t("firstGuideBlockTitle"), t("firstGuideBlockDesc")],
    [t("firstGuideSafetyTitle"), t("firstGuideSafetyDesc")],
  ];

  const createChannel = async () => {
    const normalizedSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    const normalizedName = name.trim();
    setError("");
    if (!normalizedSlug || !normalizedName) return setError(t("allFieldsRequired"));
    if (!/^[a-z0-9-]{3,30}$/.test(normalizedSlug)) return setError(t("onboardingSlugHint"));
    setSubmitting(true);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-channel", channel_id: normalizedSlug, payload: { name: normalizedName } }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) {
        setError(data.error === "channel already exists" ? t("channelExists") : t("dashboardCreateFailed"));
        return;
      }
      clearChannelLocalState(normalizedSlug);
      setCreatedChannelId(normalizedSlug);
      await onCreated(normalizedSlug);
      setStep("guide");
    } catch {
      setError(t("dashboardCreateFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,.35)", backdropFilter: "blur(5px)" }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting && step !== "guide") onClose();
      }}
    >
      <div className="w-full max-w-[430px] max-h-[calc(100dvh-32px)] overflow-hidden rounded-[24px] flex flex-col" style={{ background: "#fff", boxShadow: "0 24px 70px rgba(0,0,0,.22)" }}>
        <header className="px-5 pt-4 pb-3 flex items-center justify-between border-b" style={{ borderColor: "#e5e5ea" }}>
          <button
            type="button"
            className="min-w-[54px] border-none bg-transparent text-left text-[15px] cursor-pointer"
            style={{ color: "#007aff" }}
            onClick={() => {
              if (step === "create") setStep("features");
              else if (step === "features") onClose();
            }}
          >
            {step === "guide" ? "" : step === "features" ? t("close") : t("firstOnboardingBack")}
          </button>
          <div className="flex gap-1.5" aria-label={`${stepIndex + 1}/3`}>
            {[0, 1, 2].map((index) => (
              <span key={index} className="w-1.5 h-1.5 rounded-full" style={{ background: index === stepIndex ? "#007aff" : "#d1d1d6" }} />
            ))}
          </div>
          <span className="min-w-[54px] text-right text-[12px]" style={{ color: "#8e8e93" }}>{stepIndex + 1}/3</span>
        </header>

        <div className="min-h-0 overflow-y-auto px-6 py-6">
          {step === "features" && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-[28px]" style={{ background: "#eaf3ff" }}>💬</div>
                <h2 className="m-0 text-[24px] font-bold tracking-[-.02em]">{t("firstOnboardingTitle")}</h2>
                <p className="mt-2 mb-0 text-[14px] leading-[1.5]" style={{ color: "#8e8e93" }}>{t("firstOnboardingDesc")}</p>
              </div>
              <div className="rounded-[16px] overflow-hidden" style={{ background: "#f7f7f9" }}>
                {features.map(([title, description], index) => (
                  <div key={title} className="flex gap-3 px-4 py-4" style={{ borderBottom: index < features.length - 1 ? "0.5px solid #dedee3" : "none" }}>
                    <span className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-[18px] font-semibold" style={{ background: featureIcons[index].color, color: "#007aff" }}>{featureIcons[index].icon}</span>
                    <div className="min-w-0">
                      <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
                      <p className="mt-1 mb-0 text-[13px] leading-[1.45]" style={{ color: "#6d6d72" }}>{description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === "create" && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-[28px]" style={{ background: "#eaf3ff" }}>＋</div>
                <h2 className="m-0 text-[24px] font-bold">{t("onboardingTitle")}</h2>
                <p className="mt-2 mb-0 text-[14px]" style={{ color: "#8e8e93" }}>{t("dashboardCreateDesc")}</p>
              </div>
              <label className="block text-[12px] font-medium mb-1.5">{t("channelName")}</label>
              <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={30} className="w-full rounded-[11px] outline-none text-[15px] mb-4" style={{ border: "1px solid #d1d1d6", padding: "11px 12px", boxSizing: "border-box" }} />
              <label className="block text-[12px] font-medium mb-1.5">{t("channelSlug")}</label>
              <div className="flex items-center rounded-[11px]" style={{ border: "1px solid #d1d1d6" }}>
                <span className="pl-3 text-[13px]" style={{ color: "#8e8e93" }}>/ch/</span>
                <input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={30} placeholder="my-channel" className="min-w-0 flex-1 border-none outline-none text-[15px]" style={{ padding: "11px 12px 11px 2px", background: "transparent" }} onKeyDown={(event) => { if (event.key === "Enter" && !submitting) void createChannel(); }} />
              </div>
              <div className="mt-1.5 text-[11px]" style={{ color: "#8e8e93" }}>{t("onboardingSlugHint")}</div>
              <div className="min-h-[20px] mt-2 text-[12px]" style={{ color: "#ff3b30" }}>{error}</div>
            </>
          )}

          {step === "guide" && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-[28px]" style={{ background: "#eaf8ef" }}>✓</div>
                <h2 className="m-0 text-[24px] font-bold">{t("firstGuideTitle")}</h2>
                <p className="mt-2 mb-0 text-[14px]" style={{ color: "#8e8e93" }}>{t("firstGuideDesc")}</p>
              </div>
              <div className="rounded-[16px] overflow-hidden" style={{ background: "#f7f7f9" }}>
                {guides.map(([title, description], index) => (
                  <div key={title} className="flex gap-3 px-4 py-3.5" style={{ borderBottom: index < guides.length - 1 ? "0.5px solid #dedee3" : "none" }}>
                    <span className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[15px] font-semibold" style={{ background: "#eaf3ff", color: "#007aff" }}>{guideIcons[index]}</span>
                    <div>
                      <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
                      <p className="mt-0.5 mb-0 text-[12px] leading-[1.45]" style={{ color: "#6d6d72" }}>{description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <footer className="px-5 py-4 border-t" style={{ borderColor: "#e5e5ea", background: "rgba(255,255,255,.96)" }}>
          {step === "features" && (
            <button className="w-full border-none rounded-[12px] py-3 text-white text-[15px] font-semibold cursor-pointer" style={{ background: "#007aff" }} onClick={() => setStep("create")}>{t("firstOnboardingCreate")}</button>
          )}
          {step === "create" && (
            <button disabled={submitting} className="w-full border-none rounded-[12px] py-3 text-white text-[15px] font-semibold" style={{ background: submitting ? "#9ec9f5" : "#007aff", cursor: submitting ? "wait" : "pointer" }} onClick={() => void createChannel()}>{submitting ? t("loading") : t("create")}</button>
          )}
          {step === "guide" && (
            <div className="flex gap-2">
              <button className="flex-1 rounded-[12px] py-3 text-[14px] cursor-pointer" style={{ border: "1px solid #d1d1d6", background: "#fff", color: "#111" }} onClick={onClose}>{t("dashboardBack")}</button>
              <button className="flex-[1.4] border-none rounded-[12px] py-3 text-white text-[14px] font-semibold cursor-pointer" style={{ background: "#007aff" }} onClick={() => { window.location.href = `/ch/${createdChannelId}`; }}>{t("onboardingGoToChannel")}</button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
