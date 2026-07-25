"use client";

import { useSession } from "next-auth/react";
import { useLocale } from "@/hooks/useLocale";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { t } = useLocale();
  const [step, setStep] = useState(1);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [openItems, setOpenItems] = useState<Set<number>>(new Set());
  const [createdSlug, setCreatedSlug] = useState("");
  const guideItems = [
    { title: t("adminSettings"), detail: t("guideOpenAdminDesc") },
    { title: t("profile"), detail: t("guideProfile") },
    { title: t("rules"), detail: t("guideRules") },
    { title: t("noticeBtn"), detail: t("guideNotice") },
    { title: t("color"), detail: t("guideColor") },
    { title: t("passcode"), detail: t("guidePasscode") },
    { title: t("welcomePopup"), detail: t("guideWelcome") },
    { title: t("bannedWords"), detail: t("guideBannedWords") },
    { title: t("blockedUsers"), detail: t("guideBlock") },
    { title: t("freezeChat"), detail: t("guideFreeze") },
    { title: t("liveTitle"), detail: t("guideLive") },
  ];

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  const handleSlugInput = (val: string) => {
    setSlug(val.toLowerCase().replace(/[^a-z0-9-]/g, ""));
  };

  const handleCreate = async () => {
    setError("");
    if (status !== "authenticated" || !session?.user?.id) {
      setError(t("loginError"));
      return;
    }
    if (!slug) { setError(t("allFieldsRequired")); return; }
    if (slug.length < 3) { setError(t("allFieldsRequired")); return; }
    if (!/^[a-z0-9-]{3,30}$/.test(slug)) { setError(t("allFieldsRequired")); return; }
    if (!name.trim()) { setError(t("allFieldsRequired")); return; }

    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-channel", channel_id: slug, payload: { name: name.trim() } }),
    });
    const data = await res.json();
    if (data.error) {
      if (data.error === "channel already exists") setError(t("channelExists"));
      else setError(data.error);
      return;
    }
    setCreatedSlug(slug);
    setStep(2);
  };

  const toggleItem = (i: number) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  if (status === "loading") return null;

  return (
    <main style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", background: "#f7f7f7", minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div style={{ background: "#fff", borderRadius: "20px", padding: "36px 28px", maxWidth: "360px", width: "100%", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
        {/* Icon */}
        <div style={{ fontSize: "48px", textAlign: "center", marginBottom: "16px" }}>🎉</div>

        {/* Title */}
        <div style={{ fontSize: "22px", fontWeight: 500, textAlign: "center", marginBottom: "6px" }}>
          {step === 1 ? t("onboardingTitle") : t("onboardingComplete")}
        </div>
        {step === 1 && (
          <div style={{ fontSize: "13px", color: "#999", textAlign: "center", marginBottom: "28px", lineHeight: 1.6, whiteSpace: "pre-line" }}>
            {t("onboardingIntro")}
          </div>
        )}

        {/* Step indicator */}
        <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "24px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: step === 1 ? "#3b8df0" : "#e0e0e0" }} />
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: step === 2 ? "#3b8df0" : "#e0e0e0" }} />
        </div>

        {/* Step 1: Create */}
        {step === 1 && (
          <>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "6px" }}>{ t("channelSlug")}</label>
              <input
                type="text"
                value={slug}
                onChange={(e) => handleSlugInput(e.target.value)}
                placeholder="my-channel"
                autoComplete="off"
                style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e0e0e0", borderRadius: "12px", fontSize: "14px", fontFamily: "inherit", outline: "none", background: "#f8f8f8", boxSizing: "border-box" }}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "#3b8df0"; }}
                onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "#e0e0e0"; }}
              />
              <div style={{ fontSize: "11px", color: "#bbb", marginTop: "4px" }}>{t("onboardingSlugHint")}</div>
              {slug && <div style={{ fontSize: "12px", color: "#3b8df0", marginTop: "6px", fontWeight: 500 }}>letmetellu.vercel.app/ch/{slug}</div>}
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "6px" }}>{ t("channelName")}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("channelName")}
                maxLength={30}
                style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e0e0e0", borderRadius: "12px", fontSize: "14px", fontFamily: "inherit", outline: "none", background: "#f8f8f8", boxSizing: "border-box" }}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "#3b8df0"; }}
                onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "#e0e0e0"; }}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={status !== "authenticated" || !slug || !name.trim()}
              style={{ width: "100%", padding: "13px", border: "none", borderRadius: "14px", fontSize: "15px", fontWeight: 500, color: "#fff", background: (status !== "authenticated" || !slug || !name.trim()) ? "#ccc" : "#3b8df0", cursor: (status !== "authenticated" || !slug || !name.trim()) ? "not-allowed" : "pointer", fontFamily: "inherit", marginTop: "8px", lineHeight: 1 }}
            >
              {t("createChannel")}
            </button>
          </>
        )}

        {/* Step 2: Guide */}
        {step === 2 && (
          <>
            <div style={{ textAlign: "left", marginBottom: "20px" }}>
              <div style={{ fontSize: "18px", fontWeight: 500, color: "#222", marginBottom: "6px" }}>✅ {t("onboardingCreated")}</div>
              <div style={{ fontSize: "13px", color: "#888", marginBottom: "14px" }}>{t("onboardingGuideDesc")}</div>
              <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 0 }}>
                {guideItems.map((item, i) => (
                  <li key={i} style={{ borderBottom: i < guideItems.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                    <button
                      onClick={() => toggleItem(i)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "12px 4px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", color: "#444", textAlign: "left" }}
                    >
                      <strong style={{ fontWeight: 500 }}>{item.title}</strong>
                      <span style={{ color: openItems.has(i) ? "#3b8df0" : "#ccc", fontSize: "14px", transition: "transform 0.2s", transform: openItems.has(i) ? "rotate(90deg)" : "none" }}>›</span>
                    </button>
                    {openItems.has(i) && (
                      <div style={{ padding: "0 4px 12px", fontSize: "12px", color: "#888", lineHeight: 1.6 }}>
                        {item.detail}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: "16px", padding: "10px 12px", background: "#f0f7ff", borderRadius: "10px", fontSize: "12px", color: "#3b8df0", lineHeight: 1.5 }}>
                {t("onboardingTip")}
              </div>
            </div>
            <button
              onClick={() => router.push(`/ch/${createdSlug}`)}
              style={{ width: "100%", padding: "13px", border: "none", borderRadius: "14px", fontSize: "15px", fontWeight: 500, color: "#fff", background: "#3b8df0", cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}
            >
              {t("onboardingGoToChannel")}
            </button>
          </>
        )}

        {/* Error */}
        <div style={{ color: "#e74c3c", fontSize: "12px", textAlign: "center", marginTop: "12px", minHeight: "18px" }}>{error}</div>
      </div>
    </main>
  );
}
