"use client";

import { CloseIcon } from "@/components/ui/CloseIcon";
import { useLocale } from "@/hooks/useLocale";

function guideParts(value: string) {
  const [title, ...description] = value.split(" — ");
  return { title, description: description.join(" — ") };
}

export function UserGuidePanel({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();

  const sections = [
    {
      title: t("userGuideChatTitle"),
      entries: [
        { ...guideParts(t("userGuideReply")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>` },
        { ...guideParts(t("userGuideReactions")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1 2 1.5 3.5 1.5s2.5-.5 3.5-1.5"/><circle cx="9" cy="10" r=".8" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r=".8" fill="currentColor" stroke="none"/></svg>` },
        { ...guideParts(t("userGuideOwnMessages")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>` },
      ],
    },
    {
      title: t("userGuideSafetyTitle"),
      entries: [
        { ...guideParts(t("userGuideMessageReport")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V5"/><path d="M5 5h11l-2 4 2 4H5"/></svg>` },
        { ...guideParts(t("userGuideChannelReport")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><circle cx="12" cy="16.5" r=".9" fill="currentColor" stroke="none"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>` },
        { ...guideParts(t("userGuideBlocked")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M7 7l10 10"/></svg>` },
        { ...guideParts(t("userGuideFrozen")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8v8M14 8v8"/></svg>` },
      ],
    },
    {
      title: t("userGuideFeaturesTitle"),
      entries: [
        { ...guideParts(t("userGuideDm")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg>` },
        { ...guideParts(t("userGuideLive")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/></svg>` },
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
          <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", padding: "4px 8px" }} onClick={onClose}><CloseIcon /></button>
        </div>

        <div style={{ padding: "16px 14px 18px", maxHeight: "65vh", overflowY: "auto" }}>
          {sections.map((section, sectionIndex) => (
            <section key={`${section.title}-${sectionIndex}`} style={{ marginBottom: "18px" }}>
              <h4 style={{ margin: "0 0 7px 4px", fontSize: "calc(var(--bubble-font-size) - 4px)", fontWeight: 600, color: "var(--meta)" }}>{section.title}</h4>
              <div style={{ borderRadius: "15px", overflow: "hidden", background: "var(--card)" }}>
                {section.entries.map((entry, index) => (
                  <div key={`${entry.title}-${index}`} style={{ display: "flex", gap: "11px", padding: "13px 12px", borderBottom: index < section.entries.length - 1 ? "0.5px solid var(--hairline)" : "none" }}>
                    <span
                      style={{ width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--bubble-sent) 12%, var(--bg))", color: "var(--bubble-sent)", fontWeight: 600 }}
                      dangerouslySetInnerHTML={{
                        __html: entry.icon.replace(/<svg/, `<svg style="width:17px;height:17px"`),
                      }}
                    />
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
