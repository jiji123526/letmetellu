"use client";

import { useLocale } from "@/hooks/useLocale";

function guideParts(value: string) {
  const [title, ...description] = value.split(" — ");
  return { title, description: description.join(" — ") };
}

export function AdminGuideContent() {
  const { t } = useLocale();

  const sections = [
    {
      title: t("guideChannelTitle"),
      entries: [
        { ...guideParts(t("guideProfile")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` },
        { ...guideParts(t("guideColor")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="8.5" cy="14" r="1.5" fill="currentColor" stroke="none"/><circle cx="15.5" cy="14" r="1.5" fill="currentColor" stroke="none"/></svg>` },
        { ...guideParts(t("guideBackground")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 5"/></svg>` },
        { ...guideParts(t("guidePasscode")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>` },
        { ...guideParts(t("guideRules")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 10v5"/><circle cx="12" cy="7.2" r=".8" fill="currentColor" stroke="none"/></svg>` },
        { ...guideParts(t("guideWelcome")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>` },
      ],
    },
    {
      title: t("guideManageTitle"),
      entries: [
        { ...guideParts(t("guideDmPrivacy")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg>` },
        { ...guideParts(t("guideReport")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V5"/><path d="M5 5h11l-2 4 2 4H5"/></svg>` },
        { ...guideParts(t("guideChannelReport")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><circle cx="12" cy="16.5" r=".9" fill="currentColor" stroke="none"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>` },
        { ...guideParts(t("guideBlock")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M7 7l10 10"/></svg>` },
        { ...guideParts(t("guideUnblock")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>` },
        { ...guideParts(t("guidePetition")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 8v4"/><circle cx="12" cy="15.2" r=".9" fill="currentColor" stroke="none"/></svg>` },
        { ...guideParts(t("guideBannedWords")), icon: "Aa" },
        { ...guideParts(t("guideDelete")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 10v6M14 10v6"/></svg>` },
      ],
    },
    {
      title: t("guideSpecialTitle"),
      entries: [
        { ...guideParts(t("guideFreeze")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8v8M14 8v8"/></svg>` },
        { ...guideParts(t("guideLive")), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/></svg>` },
      ],
    },
  ];

  return (
    <div style={{ padding: "16px 14px 18px", maxHeight: "65vh", overflowY: "auto" }}>
      {sections.map((section, sectionIndex) => (
        <section key={`${section.title || "intro"}-${sectionIndex}`} style={{ marginBottom: "18px" }}>
          {section.title && <h4 style={{ margin: "0 0 7px 4px", fontSize: "calc(var(--bubble-font-size) - 4px)", fontWeight: 600, color: "var(--meta)" }}>{section.title}</h4>}
          <div style={{ borderRadius: "15px", overflow: "hidden", background: "var(--card)" }}>
            {section.entries.map((entry, index) => (
              <div key={`${entry.title}-${index}`} style={{ display: "flex", gap: "11px", padding: "13px 12px", borderBottom: index < section.entries.length - 1 ? "0.5px solid var(--hairline)" : "none" }}>
                {entry.icon.startsWith("<svg") ? (
                  <span
                    style={{ width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--bubble-sent) 12%, var(--bg))", color: "var(--bubble-sent)", fontWeight: 600 }}
                    dangerouslySetInnerHTML={{ __html: entry.icon.replace(/<svg/, `<svg style="width:17px;height:17px"`) }}
                  />
                ) : (
                  <span style={{ width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--bubble-sent) 12%, var(--bg))", color: "var(--bubble-sent)", fontSize: entry.icon === "Aa" ? "11px" : "14px", fontWeight: 600 }}>{entry.icon}</span>
                )}
                <div style={{ minWidth: 0 }}>
                  <h5 style={{ margin: 0, fontSize: "calc(var(--bubble-font-size) - 3px)", lineHeight: 1.3, fontWeight: 600, color: "var(--gray-text)" }}>{entry.title}</h5>
                  {entry.description && <p style={{ margin: "3px 0 0", fontSize: "calc(var(--bubble-font-size) - 5px)", lineHeight: 1.45, color: "var(--secondary-text)" }}>{entry.description}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <div style={{ padding: "11px 13px", background: "var(--guide-bg)", borderRadius: "12px", fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--bubble-sent)", lineHeight: 1.5 }}>{t("guideTip")}</div>
    </div>
  );
}
