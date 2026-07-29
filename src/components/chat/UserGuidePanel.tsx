"use client";

import { useLocale } from "@/hooks/useLocale";

function guideParts(value: string) {
  const [title, ...description] = value.split(" — ");
  return { title, description: description.join(" — ") };
}

export function UserGuidePanel({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();

  const sections = [
    {
      title: t("userGuideMenuTitle"),
      entries: [
        { ...guideParts(t("userGuideAccess")), icon: "?" },
        { ...guideParts(t("userGuideMenu")), icon: "⋮" },
        { ...guideParts(t("userGuideSettings")), icon: "⚙" },
        { ...guideParts(t("userGuidePasscode")), icon: "⌨" },
      ],
    },
    {
      title: t("userGuideChatTitle"),
      entries: [
        { ...guideParts(t("userGuideReply")), icon: "↩" },
        { ...guideParts(t("userGuideReactions")), icon: "☺" },
        { ...guideParts(t("userGuideOwnMessages")), icon: "✎" },
      ],
    },
    {
      title: t("userGuideSafetyTitle"),
      entries: [
        { ...guideParts(t("userGuideMessageReport")), icon: "⚑" },
        { ...guideParts(t("userGuideChannelReport")), icon: "⚐" },
        { ...guideParts(t("userGuideBlocked")), icon: "⊘" },
        { ...guideParts(t("userGuideFrozen")), icon: "❄" },
      ],
    },
    {
      title: t("userGuideFeaturesTitle"),
      entries: [
        { ...guideParts(t("userGuideDm")), icon: "✉" },
        { ...guideParts(t("userGuideLive")), icon: "◉" },
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center animate-[ctxFade_0.2s_ease]"
      style={{ background: "rgba(0,0,0,.4)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", padding: "24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "100%", maxWidth: "320px", background: "var(--bg)", color: "var(--gray-text)", borderRadius: "16px", overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "0.5px solid var(--hairline)" }}>
          <h3 style={{ margin: 0, fontSize: "var(--bubble-font-size, 16px)", fontWeight: 500 }}>{t("userGuide")}</h3>
          <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", fontSize: "18px" }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "16px 14px 18px", maxHeight: "65vh", overflowY: "auto" }}>
          {sections.map((section, sectionIndex) => (
            <section key={`${section.title}-${sectionIndex}`} style={{ marginBottom: "18px" }}>
              <h4 style={{ margin: "0 0 7px 4px", fontSize: "calc(var(--bubble-font-size) - 4px)", fontWeight: 600, color: "var(--meta)" }}>{section.title}</h4>
              <div style={{ borderRadius: "15px", overflow: "hidden", background: "var(--card)" }}>
                {section.entries.map((entry, index) => (
                  <div key={`${entry.title}-${index}`} style={{ display: "flex", gap: "11px", padding: "13px 12px", borderBottom: index < section.entries.length - 1 ? "0.5px solid var(--hairline)" : "none" }}>
                    <span style={{ width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--bubble-sent) 12%, var(--bg))", color: "var(--bubble-sent)", fontSize: entry.icon === "⋮" ? "18px" : "14px", fontWeight: 600 }}>{entry.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <h5 style={{ margin: 0, fontSize: "calc(var(--bubble-font-size) - 3px)", lineHeight: 1.3, fontWeight: 600, color: "var(--gray-text)" }}>{entry.title}</h5>
                      {entry.description && <p style={{ margin: "3px 0 0", fontSize: "calc(var(--bubble-font-size) - 5px)", lineHeight: 1.45, color: "var(--secondary-text)" }}>{entry.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <div style={{ padding: "11px 13px", background: "var(--guide-bg)", borderRadius: "12px", fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--bubble-sent)", lineHeight: 1.5 }}>{t("userGuideTip")}</div>
        </div>
      </div>
    </div>
  );
}
