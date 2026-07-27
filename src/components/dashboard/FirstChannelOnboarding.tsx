"use client";

import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocale } from "@/hooks/useLocale";
import { clearChannelLocalState } from "@/lib/channel-local-state";

type OnboardingStep = "features" | "create" | "guide";

interface FirstChannelOnboardingProps {
  onCreated: (channelId: string) => Promise<void>;
  onClose: () => void;
}

const FreezeIcon = ({ size = 20 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} className="block" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2v20M4.8 6.2l14.4 11.6M4.8 17.8 19.2 6.2M8.5 4.2 12 7l3.5-2.8M8.5 19.8 12 17l3.5 2.8M3.8 10.1 8 10.7 7.5 6.5M20.2 13.9 16 13.3l.5 4.2M3.8 13.9 8 13.3l-.5 4.2M20.2 10.1l-4.2.6.5-4.2" />
  </svg>
);

const WelcomeIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" className="block" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 5.5h14v10H9l-4 3v-13Z" />
    <path d="M9 10h.01M12 10h.01M15 10h.01" strokeWidth="2.4" />
  </svg>
);

const PasscodeIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" className="block" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="10" width="14" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
  </svg>
);

const DmIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" className="block" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
    <path d="m5 7 7 5 7-5" />
  </svg>
);

const BackgroundIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" className="block" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="8.5" cy="9" r="1.4" />
    <path d="m4.5 17 4.5-4.5 4 4 2-2 4.5 4.5" />
  </svg>
);

const featureIcons = [
  { icon: "↗", color: "#eaf3ff" },
  {
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" className="block" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
        <path d="m5 7 7 5 7-5" />
      </svg>
    ),
    color: "#f0edff",
  },
  { icon: "◉", color: "#fff0ea" },
  { icon: <FreezeIcon />, color: "#edf7ff" },
];

const guideIcons = [
  "↗",
  "5",
  (
    <svg key="profile" viewBox="0 0 24 24" width="17" height="17" className="block" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6" />
    </svg>
  ),
  <BackgroundIcon key="background" />,
  <WelcomeIcon key="welcome" />,
  <PasscodeIcon key="passcode" />,
  <DmIcon key="dm" />,
  <FreezeIcon key="freeze" size={17} />,
  "◉",
  "!",
  "⊘",
  "⚑",
];

export function FirstChannelOnboarding({ onCreated, onClose }: FirstChannelOnboardingProps) {
  const { t } = useLocale();
  const [step, setStep] = useState<OnboardingStep>("features");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [createdChannelId, setCreatedChannelId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const horizontalDrag = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLElement | null>>([]);

  const stepIndex = step === "features" ? 0 : step === "create" ? 1 : 2;
  const createFieldsValid = Boolean(name.trim()) && /^[a-z0-9-]{3,30}$/.test(slug.trim());
  const features = [
    [t("firstOnboardingPrivateTitle"), t("firstOnboardingPrivateDesc")],
    [t("firstOnboardingDmTitle"), t("firstOnboardingDmDesc")],
    [t("firstOnboardingLiveTitle"), t("firstOnboardingLiveDesc")],
    [t("firstOnboardingControlTitle"), t("firstOnboardingControlDesc")],
  ];
  const guides = [
    [t("firstGuideInviteTitle"), t("firstGuideInviteDesc")],
    [t("firstGuideLimitTitle"), t("firstGuideLimitDesc")],
    [t("firstGuideProfileTitle"), t("firstGuideProfileDesc")],
    [t("firstGuideBackgroundTitle"), t("firstGuideBackgroundDesc")],
    [t("firstGuideWelcomeTitle"), t("firstGuideWelcomeDesc")],
    [t("firstGuidePasscodeTitle"), t("firstGuidePasscodeDesc")],
    [t("firstGuideDmTitle"), t("firstGuideDmDesc")],
    [t("firstGuideFreezeTitle"), t("firstGuideFreezeDesc")],
    [t("firstGuideLiveTitle"), t("firstGuideLiveDesc")],
    [t("firstGuideNoticeTitle"), t("firstGuideNoticeDesc")],
    [t("firstGuideBlockTitle"), t("firstGuideBlockDesc")],
    [t("firstGuideSafetyTitle"), t("firstGuideSafetyDesc")],
  ];

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [step]);

  useLayoutEffect(() => {
    const pageEl = pageRefs.current[stepIndex];
    if (!pageEl) return;

    const updateHeight = () => setContentHeight(pageEl.offsetHeight);
    updateHeight();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(pageEl);
    return () => observer.disconnect();
  }, [stepIndex, name, slug, error]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || step === "guide") return;
    if ((event.target as HTMLElement).closest("input, textarea, button")) return;
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
    const blocked = (step === "features" && dx > 0) || (step === "create" && dx < 0);
    setDragX(blocked ? dx * 0.18 : dx);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dx = dragX;
    dragStart.current = null;
    horizontalDrag.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    setDragX(0);
    if (step === "features" && dx < -60) setStep("create");
    else if (step === "create" && dx > 60) setStep("features");
  };

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
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-[430px] max-h-[calc(100dvh-32px)] overflow-hidden rounded-[24px] flex flex-col" style={{ background: "var(--bg)", color: "var(--gray-text)", boxShadow: "0 24px 70px rgba(0,0,0,.22)" }}>
        <header className="px-5 pt-4 pb-3 flex items-center justify-between border-b" style={{ borderColor: "var(--hairline)" }}>
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
          {step === "create" && createFieldsValid ? (
            <button
              type="button"
              disabled={submitting}
              className="min-w-[54px] border-none bg-transparent p-0 text-right text-[15px] font-medium"
              style={{ color: "#007aff", cursor: submitting ? "wait" : "pointer", opacity: submitting ? 0.6 : 1 }}
              onClick={() => void createChannel()}
            >
              {submitting ? t("loading") : t("create")}
            </button>
          ) : (
            <span className="min-w-[54px]" aria-hidden="true" />
          )}
        </header>

        <div
          ref={contentRef}
          className="onboarding-scroll min-h-0 overflow-x-hidden overflow-y-auto"
          style={{
            touchAction: "pan-y",
            overflowY: "auto",
            height: contentHeight ? `${contentHeight}px` : undefined,
            transition: dragging ? "none" : "height 220ms cubic-bezier(.22,.61,.36,1)",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <div
            className="flex items-start w-[300%]"
            style={{
              height: contentHeight ? `${contentHeight}px` : undefined,
              overflow: "hidden",
              transform: `translateX(calc(-${stepIndex * (100 / 3)}% + ${dragX}px))`,
              transition: dragging ? "none" : "transform 220ms cubic-bezier(.22,.61,.36,1)",
            }}
          >
            <section
              ref={(node) => { pageRefs.current[0] = node; }}
              className="w-1/3 flex-none px-6 py-6"
              aria-hidden={step !== "features"}
            >
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: "#eaf3ff" }}>
                  <Image src="/logo.svg" alt="" width={36} height={36} className="h-9 w-9" />
                </div>
                <h2 className="m-0 text-[24px] font-bold tracking-[-.02em]">{t("firstOnboardingTitle")}</h2>
                <p className="mt-2 mb-0 text-[14px] leading-[1.5]" style={{ color: "var(--meta)" }}>{t("firstOnboardingDesc")}</p>
              </div>
              <div className="rounded-[16px] overflow-hidden" style={{ background: "var(--card)" }}>
                {features.map(([title, description], index) => (
                  <div key={title} className="flex gap-3 px-4 py-4" style={{ borderBottom: index < features.length - 1 ? "0.5px solid #dedee3" : "none" }}>
                    <span className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-[18px] font-semibold" style={{ background: featureIcons[index].color, color: "#007aff" }}>{featureIcons[index].icon}</span>
                    <div className="min-w-0">
                      <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
                      <p className="mt-1 mb-0 text-[13px] leading-[1.45]" style={{ color: "var(--secondary-text)" }}>{description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section
              ref={(node) => { pageRefs.current[1] = node; }}
              className="w-1/3 flex-none px-6 py-6"
              aria-hidden={step !== "create"}
            >
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-[28px]" style={{ background: "#eaf3ff" }}>＋</div>
                <h2 className="m-0 text-[24px] font-bold">{t("onboardingTitle")}</h2>
                <p className="mt-2 mb-0 text-[14px]" style={{ color: "var(--meta)" }}>{t("dashboardCreateDesc")}</p>
              </div>
              <label className="block text-[12px] font-medium mb-1.5">{t("channelName")}</label>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={30} className="w-full rounded-[11px] outline-none text-[15px] mb-4" style={{ border: "1px solid var(--input-border)", padding: "11px 12px", boxSizing: "border-box", background: "var(--input-bg)", color: "var(--gray-text)" }} />
              <label className="block text-[12px] font-medium mb-1.5">{t("channelSlug")}</label>
              <div className="flex items-center rounded-[11px]" style={{ border: "1px solid var(--input-border)", background: "var(--input-bg)" }}>
                <span className="pl-3 text-[13px]" style={{ color: "var(--meta)" }}>/ch/</span>
                <input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={30} placeholder="my-channel" className="min-w-0 flex-1 border-none outline-none text-[15px]" style={{ padding: "11px 12px 11px 2px", background: "transparent", color: "var(--gray-text)" }} onKeyDown={(event) => { if (event.key === "Enter" && !submitting && createFieldsValid) void createChannel(); }} />
              </div>
              <div className="mt-1.5 text-[11px]" style={{ color: "var(--meta)" }}>{t("onboardingSlugHint")}</div>
              <div className="min-h-[20px] mt-2 text-[12px]" style={{ color: "#ff3b30" }}>{error}</div>
            </section>

            <section
              ref={(node) => { pageRefs.current[2] = node; }}
              className="w-1/3 flex-none px-6 py-6"
              aria-hidden={step !== "guide"}
            >
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-[28px]" style={{ background: "#eaf8ef" }}>✓</div>
                <h2 className="m-0 text-[24px] font-bold">{t("firstGuideTitle")}</h2>
                <p className="mt-2 mb-0 text-[14px]" style={{ color: "var(--meta)" }}>{t("firstGuideDesc")}</p>
              </div>
              <div className="rounded-[16px] overflow-hidden" style={{ background: "var(--card)" }}>
                {guides.map(([title, description], index) => (
                  <div key={title} className="flex gap-3 px-4 py-3.5" style={{ borderBottom: index < guides.length - 1 ? "0.5px solid #dedee3" : "none" }}>
                    <span className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[15px] font-semibold" style={{ background: "#eaf3ff", color: "#007aff" }}>{guideIcons[index]}</span>
                    <div>
                      <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
                      <p className="mt-0.5 mb-0 text-[12px] leading-[1.45]" style={{ color: "var(--secondary-text)" }}>{description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        {step === "guide" && (
          <footer className="px-5 py-4 border-t" style={{ borderColor: "var(--hairline)", background: "var(--header-bg)" }}>
            <div className="flex gap-2">
              <button className="flex-1 rounded-[12px] py-3 text-[14px] cursor-pointer" style={{ border: "1px solid var(--input-border)", background: "var(--card)", color: "var(--gray-text)" }} onClick={onClose}>{t("dashboardBack")}</button>
              <button className="flex-[1.4] border-none rounded-[12px] py-3 text-white text-[14px] font-semibold cursor-pointer" style={{ background: "#007aff" }} onClick={() => { window.location.href = `/ch/${createdChannelId}`; }}>{t("onboardingGoToChannel")}</button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
