"use client";

import { useEffect, useState, useRef } from "react";
import { adminAction, uploadAdminImage } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { ProfileImageCropper } from "./ProfileImageCropper";

interface AdminPanelProps {
  channelId: string;
  channelName: string;
  profileImage: string | null;
  currentColor: string;
  backgroundType: "default" | "color" | "image";
  backgroundColor: string | null;
  backgroundImage: string | null;
  backgroundOverlay: number;
  backgroundBlur: boolean;
  passcodeHint: string;
  isFrozen: boolean;
  liveActive: boolean;
  petitionEnabled: boolean;
  dmEnabled: boolean;
  showOnProfile: boolean;
  notice: string;
  blockedUsers: { uid: string; reason: string }[];
  onFreeze: () => void;
  onUnfreeze: () => void;
  onLive: () => void;
  onToggleView: () => void;
  onPetitionToggle: () => void;
  onDmToggle: () => void;
  onShowOnProfileToggle: (visible: boolean) => void;
  onColorChange: (color: string) => void;
  onBackgroundChange: (background: {
    background_type: "default" | "color" | "image";
    background_color: string | null;
    background_image: string | null;
    background_overlay: number;
    background_blur: number;
  }) => void;
  onNameChange: (name: string) => void;
  onProfileImageChange: (url: string) => void;
  onNoticeChange: (notice: string) => void;
  onWelcomeChange: (config: string) => void;
  welcomeConfig: string;
  onUnblock: (uid: string) => void;
  onClose: () => void;
}

type PanelView = "main" | "channel" | "manage" | "profile" | "color" | "background" | "passcode" | "rules" | "welcome" | "banned-words" | "blocked" | "guide";

const BUBBLE_COLORS = ["#3b8df0", "#9b59b6", "#2e7d32", "#e74c3c", "#f39c12", "#1abc9c", "#e91e63"];
const BACKGROUND_COLORS = ["#f2f2f7", "#eef5ff", "#f2efff", "#eef8f2", "#fff5e8", "#fff0f3", "#202124"];

function darkenColor(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
}

interface MenuItem { key: string; label: string; icon: string; arrow: string; arrowColor?: string; }

function guideParts(value: string) {
  const [title, ...description] = value.split(" — ");
  return { title, description: description.join(" — ") };
}

export function AdminPanel(props: AdminPanelProps) {
  const { channelId, channelName, profileImage, currentColor, backgroundType, backgroundColor, backgroundImage, backgroundOverlay, backgroundBlur, passcodeHint, isFrozen, liveActive, petitionEnabled, dmEnabled, showOnProfile, notice, welcomeConfig, blockedUsers, onFreeze, onUnfreeze, onLive, onToggleView, onPetitionToggle, onDmToggle, onShowOnProfileToggle, onColorChange, onBackgroundChange, onNameChange, onProfileImageChange, onNoticeChange, onWelcomeChange, onUnblock, onClose } = props;
  const { t } = useLocale();
  const [view, setView] = useState<PanelView>("main");
  const [nameInput, setNameInput] = useState(channelName);
  const [selectedColor, setSelectedColor] = useState(currentColor);
  const [selectedBackgroundType, setSelectedBackgroundType] = useState(backgroundType);
  const [selectedBackgroundColor, setSelectedBackgroundColor] = useState(backgroundColor || "#f2f2f7");
  const [selectedBackgroundImage, setSelectedBackgroundImage] = useState(backgroundImage);
  const [backgroundImageFile, setBackgroundImageFile] = useState<File | null>(null);
  const [selectedBackgroundOverlay, setSelectedBackgroundOverlay] = useState(backgroundOverlay);
  const [selectedBackgroundBlur, setSelectedBackgroundBlur] = useState(backgroundBlur);
  const [savingBackground, setSavingBackground] = useState(false);
  const [backgroundError, setBackgroundError] = useState("");
  const [visibleOnProfile, setVisibleOnProfile] = useState(showOnProfile);
  const [profileImagePreview, setProfileImagePreview] = useState(profileImage);
  const [profileImageFile, setProfileImageFile] = useState<File | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState("");
  const [rules, setRules] = useState<{ title: string; items: string[] }[]>(() => {
    try { return JSON.parse(notice || "[]"); } catch { return []; }
  });
  const [bannedWords, setBannedWords] = useState<{ word: string; expires: string | null }[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(`bannedWords_${channelId}`) || "[]"); } catch { return []; }
  });
  const [bannedInput, setBannedInput] = useState("");
  const [bannedDuration, setBannedDuration] = useState("");
  const [welcomeIcon, setWelcomeIcon] = useState(() => {
    try {
      const p = JSON.parse(welcomeConfig || "{}");
      return typeof p.icon === "string" && !p.icon.startsWith("blob:") && p.icon !== "💬" ? p.icon : "";
    } catch { return ""; }
  });
  const [welcomeTitle, setWelcomeTitle] = useState(() => {
    try { const p = JSON.parse(welcomeConfig || "{}"); return p.title || t("welcomeDefaultTitle"); } catch { return t("welcomeDefaultTitle"); }
  });
  const [welcomeItems, setWelcomeItems] = useState(() => {
    try { const p = JSON.parse(welcomeConfig || "{}"); return (p.items || []).join("\n"); } catch { return ""; }
  });
  const colorInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (selectedBackgroundImage?.startsWith("blob:")) {
        URL.revokeObjectURL(selectedBackgroundImage);
      }
    };
  }, [selectedBackgroundImage]);

  const saveProfile = async () => {
    if (savingProfile) return;
    setSavingProfile(true);
    setProfileSaveError("");
    let uploadedImage: string | null = null;
    if (profileImageFile) {
      try {
        uploadedImage = await uploadAdminImage(profileImageFile, channelId);
      } catch {
        uploadedImage = null;
      }
      if (!uploadedImage) {
        setProfileSaveError(t("profileSaveFailed"));
        setSavingProfile(false);
        return;
      }
    }
    if (nameInput !== channelName) onNameChange(nameInput);
    if (uploadedImage) onProfileImageChange(uploadedImage);
    if (visibleOnProfile !== showOnProfile) onShowOnProfileToggle(visibleOnProfile);
    setSavingProfile(false);
    onClose();
  };

  const mainItems: MenuItem[] = [
    { key: "channel", label: t("channel"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>`, arrow: "›" },
    { key: "manage", label: t("manage"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`, arrow: "›" },
    { key: "freeze", label: isFrozen ? t("unfreezeChat") : t("freezeChat"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M17 7l-10 10M2 12h20M7 7l10 10"/></svg>`, arrow: "●", arrowColor: isFrozen ? "#4a4d8f" : undefined },
    { key: "live", label: liveActive ? t("liveStop") : t("liveStart"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M4.93 4.93a10 10 0 0 1 14.14 0"/><path d="M7.76 7.76a6 6 0 0 1 8.48 0"/></svg>`, arrow: "●", arrowColor: liveActive ? "#c0392b" : undefined },
    { key: "guide", label: t("guide"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`, arrow: "›" },
    { key: "toggle-view", label: t("viewAsUser"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`, arrow: "›" },
  ];

  const channelItems: MenuItem[] = [
    { key: "profile", label: t("profile"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`, arrow: "›" },
    { key: "color", label: t("color"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="8" r="2" fill="currentColor"/><circle cx="8" cy="14" r="2" fill="currentColor"/><circle cx="16" cy="14" r="2" fill="currentColor"/></svg>`, arrow: "›" },
    { key: "background", label: t("chatBackground"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 5"/></svg>`, arrow: "›" },
    { key: "passcode", label: t("passcode"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`, arrow: "›" },
    { key: "rules", label: t("rules"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></svg>`, arrow: "›" },
    { key: "welcome", label: t("welcomePopup"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`, arrow: "›" },
  ];

  const manageItems: MenuItem[] = [
    { key: "banned-words", label: t("bannedWords"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18.36 5.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`, arrow: "›" },
    { key: "blocked", label: t("blockedUsers"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg>`, arrow: "›" },
    { key: "petition-toggle", label: petitionEnabled ? t("petitionOn") : t("petitionOff"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`, arrow: "●", arrowColor: petitionEnabled ? "#2a9d4e" : "#c0392b" },
    { key: "dm-toggle", label: dmEnabled ? t("dmOn") : t("dmOff"), icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`, arrow: "●", arrowColor: dmEnabled ? "#2a9d4e" : "#c0392b" },
  ];

  const handleClick = (key: string) => {
    switch (key) {
      case "channel": setView("channel"); break;
      case "manage": setView("manage"); break;
      case "profile": setView("profile"); break;
      case "color": setView("color"); break;
      case "background": setView("background"); break;
      case "passcode": setView("passcode"); break;
      case "rules": setView("rules"); break;
      case "welcome": setView("welcome"); break;
      case "banned-words": setView("banned-words"); break;
      case "blocked": setView("blocked"); break;
      case "guide": setView("guide"); break;
      case "freeze": onClose(); isFrozen ? onUnfreeze() : onFreeze(); break;
      case "live": onClose(); onLive(); break;
      case "toggle-view": onClose(); onToggleView(); break;
      case "petition-toggle": onPetitionToggle(); break;
      case "dm-toggle": onDmToggle(); break;
    }
  };

  const goBack = () => {
    if (view === "profile" || view === "color" || view === "background" || view === "passcode" || view === "rules" || view === "welcome") setView("channel");
    else if (view === "banned-words" || view === "blocked") setView("manage");
    else if (view === "channel" || view === "manage" || view === "guide") setView("main");
    else onClose();
  };

  const addBannedWord = () => {
    const word = bannedInput.trim();
    if (!word || bannedWords.find((w) => w.word === word)) { setBannedInput(""); return; }
    const days = bannedDuration ? parseInt(bannedDuration) : null;
    const expires = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;
    const next = [...bannedWords, { word, expires }];
    setBannedWords(next);
    setBannedInput("");
    localStorage.setItem(`bannedWords_${channelId}`, JSON.stringify(next));
    adminAction("add-banned-word", channelId, { word, expires });
  };

  const renderMenuList = (items: MenuItem[]) => (
    <div style={{ padding: "0 0 8px" }}>
      {items.map((item, i) => (
        <button
          key={item.key}
          style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%", background: "none", border: "none", borderBottom: i < items.length - 1 ? "0.5px solid var(--hairline)" : "none", padding: "14px 18px", cursor: "pointer", fontFamily: "inherit", color: "var(--gray-text)" }}
          onClick={() => handleClick(item.key)}
        >
          <span style={{ width: "calc(var(--bubble-font-size, 17px) + 4px)", height: "calc(var(--bubble-font-size, 17px) + 4px)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--meta)" }} dangerouslySetInnerHTML={{ __html: item.icon.replace(/<svg/, `<svg style="width:calc(var(--bubble-font-size, 17px) + 2px);height:calc(var(--bubble-font-size, 17px) + 2px)"`) }} />
          <span style={{ flex: 1, fontSize: "var(--bubble-font-size, 15px)", fontWeight: 400, textAlign: "left" }}>{item.label}</span>
          <span style={{ color: item.arrowColor || "var(--meta)", fontSize: "var(--bubble-font-size, 18px)" }}>{item.arrow}</span>
        </button>
      ))}
    </div>
  );

  const inputStyle: React.CSSProperties = { width: "100%", border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--gray-text)", borderRadius: "12px", padding: "11px 14px", fontSize: "15px", fontFamily: "inherit", marginBottom: "8px", lineHeight: 1 };
  const saveBtnStyle: React.CSSProperties = { width: "100%", border: "none", cursor: "pointer", background: "var(--bubble-sent, #3b8df0)", color: "#fff", fontWeight: 500, fontSize: "15px", borderRadius: "12px", padding: "12px", fontFamily: "inherit", lineHeight: 1 };

  const title = { main: t("adminSettingsTitle"), channel: t("channel"), manage: t("manage"), profile: t("profile"), color: t("color"), background: t("chatBackground"), passcode: t("passcode"), rules: t("rules"), welcome: t("welcomePopup"), "banned-words": t("bannedWords"), blocked: t("blockedUsers"), guide: t("guide") }[view];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center animate-[ctxFade_0.2s_ease]"
      style={{ background: "rgba(0,0,0,.4)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", padding: "24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) goBack(); }}
    >
      <div style={{ width: "100%", maxWidth: "320px", background: "var(--bg)", color: "var(--gray-text)", borderRadius: "16px", overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "0.5px solid var(--hairline)" }}>
          <h3 style={{ margin: 0, fontSize: "var(--bubble-font-size, 16px)", fontWeight: 500 }}>{title}</h3>
          <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", fontSize: "18px" }} onClick={goBack}>✕</button>
        </div>

        {/* Content */}
        {view === "main" && renderMenuList(mainItems)}
        {view === "channel" && renderMenuList(channelItems)}
        {view === "manage" && renderMenuList(manageItems)}

        {/* Profile panel */}
        {view === "profile" && (
          <div style={{ padding: "20px 18px" }}>
            {/* Profile image upload */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
              <div
                style={{ width: "80px", height: "80px", borderRadius: "20px", overflow: "hidden", border: "2px dashed var(--hairline)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--card)" }}
                onClick={() => document.getElementById("profileImgInput")?.click()}
              >
                {profileImagePreview ? (
                  <img src={profileImagePreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: "28px" }}>💬</span>
                )}
              </div>
              <button
                style={{ background: "var(--card)", border: "1px solid var(--input-border)", borderRadius: "10px", padding: "8px 16px", fontSize: "calc(var(--bubble-font-size) - 5px)", cursor: "pointer", fontFamily: "inherit", color: "var(--card-text)" }}
                onClick={() => document.getElementById("profileImgInput")?.click()}
              >
                {t("changePhoto")}
              </button>
              <input id="profileImgInput" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                e.target.value = "";
                setProfileSaveError("");
                if (file.type === "image/gif") {
                  const reader = new FileReader();
                  reader.onload = () => {
                    setProfileImageFile(file);
                    setProfileImagePreview(typeof reader.result === "string" ? reader.result : "");
                    setCropFile(null);
                  };
                  reader.readAsDataURL(file);
                  return;
                }
                setCropFile(file);
              }} />
            </div>

            {/* Channel name */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--meta)", fontWeight: 700, marginBottom: "8px" }}>{ t("channelName")}</div>
              <input
                style={{ width: "100%", background: "var(--card)", border: "1.5px solid var(--input-border)", borderRadius: "12px", padding: "11px 14px", fontSize: "calc(var(--bubble-font-size) - 3px)", color: "var(--gray-text)", fontFamily: "inherit", boxSizing: "border-box" as const, outline: "none" }}
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={20}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "13px 0", marginBottom: "16px", borderTop: "0.5px solid var(--hairline)", borderBottom: "0.5px solid var(--hairline)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "calc(var(--bubble-font-size) - 3px)", color: "var(--gray-text)", fontWeight: 500 }}>{t("showChannelOnProfile")}</div>
                <div style={{ marginTop: "3px", fontSize: "calc(var(--bubble-font-size) - 6px)", lineHeight: 1.4, color: "var(--meta)" }}>{t("showChannelOnProfileDesc")}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={visibleOnProfile}
                aria-label={t("showChannelOnProfile")}
                onClick={() => {
                  const next = !visibleOnProfile;
                  setVisibleOnProfile(next);
                }}
                style={{
                  position: "relative",
                  width: "46px",
                  height: "28px",
                  flexShrink: 0,
                  border: "none",
                  borderRadius: "999px",
                  padding: 0,
                  cursor: "pointer",
                  background: visibleOnProfile ? "#34c759" : "var(--input-border)",
                  transition: "background 180ms ease",
                }}
              >
                <span style={{ position: "absolute", top: "2px", left: "2px", width: "24px", height: "24px", borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transform: visibleOnProfile ? "translateX(18px)" : "translateX(0)", transition: "transform 180ms ease" }} />
              </button>
            </div>

            {profileSaveError && <div className="mb-3 text-center text-[12px]" style={{ color: "#ff3b30" }}>{profileSaveError}</div>}
            <button disabled={savingProfile} style={{ ...saveBtnStyle, cursor: savingProfile ? "wait" : "pointer", opacity: savingProfile ? 0.65 : 1 }} onClick={() => void saveProfile()}>
              {savingProfile ? t("loading") : t("save")}
            </button>
          </div>
        )}

        {/* Color panel */}
        {view === "color" && (
          <div style={{ padding: "12px 18px" }}>
            <div style={{ fontSize: "13px", color: "var(--meta)", textAlign: "center", marginBottom: "16px" }}>{t("colorDesc")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", width: "200px", margin: "0 auto", justifyItems: "center", padding: "2px" }}>
              {BUBBLE_COLORS.map((color) => (
                <button
                  key={color}
                  style={{ width: "calc(var(--bubble-font-size, 17px) + 9px)", height: "calc(var(--bubble-font-size, 17px) + 9px)", borderRadius: "50%", background: color, border: "3px solid transparent", outline: selectedColor === color ? `3px solid ${darkenColor(color, 50)}` : "3px solid transparent", cursor: "pointer", transition: "outline-color .15s" }}
                  onClick={() => { setSelectedColor(color); onColorChange(color); }}
                />
              ))}
              <button
                style={{ width: "calc(var(--bubble-font-size, 17px) + 9px)", height: "calc(var(--bubble-font-size, 17px) + 9px)", borderRadius: "50%", background: "conic-gradient(red,orange,yellow,green,cyan,blue,violet,red)", border: "3px solid transparent", outline: !BUBBLE_COLORS.includes(selectedColor) ? `3px solid ${darkenColor(selectedColor, 50)}` : "3px solid transparent", cursor: "pointer", position: "relative", overflow: "hidden" }}
              >
                <input ref={colorInputRef} type="color" value={selectedColor} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }} onChange={(e) => { setSelectedColor(e.target.value); onColorChange(e.target.value); }} />
              </button>
            </div>
          </div>
        )}

        {view === "background" && (
          <div style={{ padding: "14px 18px 18px" }}>
            <div
              style={{
                height: "150px",
                marginBottom: "14px",
                borderRadius: "14px",
                border: "1px solid var(--hairline)",
                backgroundColor: selectedBackgroundType === "color" ? selectedBackgroundColor : "var(--bg)",
                backgroundImage: selectedBackgroundType === "image" && selectedBackgroundImage
                  ? `linear-gradient(rgba(0,0,0,${selectedBackgroundOverlay / 100}), rgba(0,0,0,${selectedBackgroundOverlay / 100})), url("${selectedBackgroundImage}")`
                  : undefined,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: selectedBackgroundType === "image" && selectedBackgroundBlur ? "blur(5px)" : "none",
                transform: selectedBackgroundType === "image" && selectedBackgroundBlur ? "scale(1.04)" : "none",
              }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", marginBottom: "12px" }}>
              {(["default", "color", "image"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSelectedBackgroundType(type)}
                  style={{
                    border: selectedBackgroundType === type ? "1.5px solid var(--bubble-sent)" : "1px solid var(--input-border)",
                    borderRadius: "10px",
                    padding: "9px 4px",
                    background: "var(--card)",
                    color: selectedBackgroundType === type ? "var(--bubble-sent)" : "var(--gray-text)",
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {t(type === "default" ? "backgroundDefault" : type === "color" ? "backgroundColor" : "backgroundImage")}
                </button>
              ))}
            </div>
            {selectedBackgroundType === "color" && (
              <div style={{ padding: "4px 0 14px" }}>
                <div style={{ fontSize: "12px", color: "var(--meta)", textAlign: "center", marginBottom: "12px" }}>{t("backgroundColor")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "9px", width: "210px", margin: "0 auto", justifyItems: "center", padding: "3px" }}>
                  {BACKGROUND_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      onClick={() => setSelectedBackgroundColor(color)}
                      style={{
                        width: "calc(var(--bubble-font-size, 17px) + 13px)",
                        height: "calc(var(--bubble-font-size, 17px) + 13px)",
                        borderRadius: "50%",
                        background: color,
                        border: "1px solid var(--hairline)",
                        outline: selectedBackgroundColor.toLowerCase() === color.toLowerCase() ? `3px solid var(--bubble-sent)` : "3px solid transparent",
                        outlineOffset: "1px",
                        cursor: "pointer",
                      }}
                    />
                  ))}
                  <label
                    aria-label={t("customColor")}
                    style={{
                      width: "calc(var(--bubble-font-size, 17px) + 13px)",
                      height: "calc(var(--bubble-font-size, 17px) + 13px)",
                      borderRadius: "50%",
                      background: "conic-gradient(red,orange,yellow,green,cyan,blue,violet,red)",
                      border: "1px solid var(--hairline)",
                      outline: !BACKGROUND_COLORS.some((color) => color.toLowerCase() === selectedBackgroundColor.toLowerCase()) ? "3px solid var(--bubble-sent)" : "3px solid transparent",
                      outlineOffset: "1px",
                      cursor: "pointer",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <input
                      type="color"
                      value={selectedBackgroundColor}
                      onChange={(event) => setSelectedBackgroundColor(event.target.value)}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                    />
                  </label>
                </div>
              </div>
            )}
            {selectedBackgroundType === "image" && (
              <>
                <button type="button" style={{ ...saveBtnStyle, background: "var(--card)", color: "var(--gray-text)", border: "1px solid var(--input-border)", marginBottom: "12px" }} onClick={() => document.getElementById("backgroundImageInput")?.click()}>
                  {selectedBackgroundImage ? t("changeBackgroundImage") : t("uploadBackgroundImage")}
                </button>
                <input
                  id="backgroundImageInput"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setBackgroundError("");
                    if (file.size > 5 * 1024 * 1024) {
                      setBackgroundError(t("backgroundFileTooLarge"));
                      return;
                    }
                    setBackgroundImageFile(file);
                    setSelectedBackgroundImage(URL.createObjectURL(file));
                  }}
                />
                <label style={{ display: "block", fontSize: "13px", color: "var(--meta)", marginBottom: "14px" }}>
                  <span style={{ display: "flex", justifyContent: "space-between", marginBottom: "7px" }}>
                    <span>{t("backgroundOverlay")}</span><span>{selectedBackgroundOverlay}%</span>
                  </span>
                  <input type="range" min="0" max="60" value={selectedBackgroundOverlay} onChange={(event) => setSelectedBackgroundOverlay(Number(event.target.value))} style={{ width: "100%" }} />
                </label>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", marginBottom: "14px" }}>
                  <div>
                    <div style={{ fontSize: "13px", color: "var(--gray-text)" }}>{t("backgroundBlur")}</div>
                    <div style={{ marginTop: "3px", fontSize: "11px", color: "var(--meta)" }}>{t("backgroundBlurDesc")}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={selectedBackgroundBlur}
                    onClick={() => setSelectedBackgroundBlur((value) => !value)}
                    style={{ position: "relative", width: "46px", height: "28px", flexShrink: 0, border: 0, borderRadius: "999px", padding: 0, cursor: "pointer", background: selectedBackgroundBlur ? "#34c759" : "var(--input-border)", transition: "background 180ms ease" }}
                  >
                    <span style={{ position: "absolute", top: "2px", left: "2px", width: "24px", height: "24px", borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transform: selectedBackgroundBlur ? "translateX(18px)" : "translateX(0)", transition: "transform 180ms ease" }} />
                  </button>
                </div>
              </>
            )}
            {backgroundError && <div style={{ color: "#ff3b30", textAlign: "center", fontSize: "12px", marginBottom: "10px" }}>{backgroundError}</div>}
            <button
              type="button"
              disabled={savingBackground || (selectedBackgroundType === "image" && !selectedBackgroundImage)}
              style={{ ...saveBtnStyle, opacity: savingBackground || (selectedBackgroundType === "image" && !selectedBackgroundImage) ? 0.55 : 1 }}
              onClick={async () => {
                if (savingBackground) return;
                setSavingBackground(true);
                setBackgroundError("");
                let imageUrl = selectedBackgroundType === "image" ? selectedBackgroundImage : null;
                if (selectedBackgroundType === "image" && backgroundImageFile) {
                  try {
                    imageUrl = await uploadAdminImage(backgroundImageFile, channelId);
                  } catch {
                    imageUrl = null;
                  }
                  if (!imageUrl) {
                    setBackgroundError(t("backgroundUploadFailed"));
                    setSavingBackground(false);
                    return;
                  }
                }
                onBackgroundChange({
                  background_type: selectedBackgroundType,
                  background_color: selectedBackgroundType === "color" ? selectedBackgroundColor : null,
                  background_image: imageUrl,
                  background_overlay: selectedBackgroundOverlay,
                  background_blur: selectedBackgroundBlur ? 1 : 0,
                });
                setSavingBackground(false);
                goBack();
              }}
            >
              {savingBackground ? t("loading") : t("save")}
            </button>
          </div>
        )}

        {/* Passcode panel */}
        {view === "passcode" && (
          <div style={{ padding: "12px 18px" }}>
            <div style={{ fontSize: "13px", color: "var(--meta)", marginBottom: "6px" }}>{t("currentChannel")}: {channelName}</div>
            <input id="passcode-input" style={inputStyle} type="text" placeholder={t("newPasscode")} autoComplete="off" />
            <div style={{ fontSize: "11px", color: "var(--meta)", marginBottom: "12px" }}>{t("passcodeHint")}</div>
            <input id="passcode-hint-input" style={inputStyle} type="text" defaultValue={passcodeHint} placeholder={t("passcodeHintPlaceholder")} maxLength={200} autoComplete="off" />
            <div style={{ fontSize: "11px", color: "var(--meta)", marginBottom: "12px" }}>{t("passcodeHintPublic")}</div>
            <button style={saveBtnStyle} onClick={() => {
              const input = document.getElementById("passcode-input") as HTMLInputElement;
              const hintInput = document.getElementById("passcode-hint-input") as HTMLInputElement;
              const value = input?.value?.trim() || "";
              const hint = hintInput?.value?.trim() || "";
              adminAction("set-passcode", channelId, { passcode: value || null, hint });
              goBack();
            }}>{ t("save")}</button>
          </div>
        )}

        {/* Rules panel */}
        {view === "rules" && (
          <div style={{ padding: "12px 18px", maxHeight: "60vh", overflowY: "auto" }}>
            {rules.map((section, i) => (
              <div key={i} style={{ marginBottom: "16px", padding: "12px", borderRadius: "12px", border: "1px solid var(--hairline)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                  <input style={{ ...inputStyle, flex: 1, marginRight: "8px", marginBottom: 0 }} value={section.title} placeholder={t("sectionTitle")} onChange={(e) => { const r = [...rules]; r[i] = { ...r[i], title: e.target.value }; setRules(r); }} />
                  <button style={{ background: "none", border: "none", color: "#c0392b", cursor: "pointer", fontSize: "18px" }} onClick={() => setRules(rules.filter((_, j) => j !== i))}>✕</button>
                </div>
                <textarea style={{ ...inputStyle, marginBottom: 0, resize: "vertical" }} rows={3} placeholder={t("sectionItems")} value={section.items.join("\n")} onChange={(e) => { const r = [...rules]; r[i] = { ...r[i], items: e.target.value.split("\n") }; setRules(r); }} />
              </div>
            ))}
            <button style={{ ...saveBtnStyle, background: "var(--card)", color: "var(--secondary-text)", marginBottom: "12px" }} onClick={() => setRules([...rules, { title: "", items: [] }])}>{t("addSection")}</button>
            <button style={saveBtnStyle} onClick={() => { const cleaned = rules.filter(s => s.title.trim() || s.items.some(i => i.trim())).map(s => ({ title: s.title.trim(), items: s.items.map(i => i.trim()).filter(Boolean) })); onNoticeChange(JSON.stringify(cleaned)); goBack(); }}>{ t("save")}</button>
          </div>
        )}

        {/* Banned words panel */}
        {view === "banned-words" && (
          <div style={{ padding: "12px 18px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "12px", maxHeight: "200px", overflowY: "auto" }}>
              {bannedWords.length === 0 ? (
                <div style={{ color: "var(--meta)", fontSize: "var(--bubble-font-size, 13px)", textAlign: "center", padding: "12px 0" }}>{ t("noBannedWords")}</div>
              ) : bannedWords.map((w, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--card)", borderRadius: "10px" }}>
                  <span style={{ fontSize: "var(--bubble-font-size, 14px)", color: "var(--gray-text)" }}>{w.word}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--meta)" }}>
                      {w.expires ? (() => { const diff = new Date(w.expires).getTime() - Date.now(); return diff > 0 ? `${Math.ceil(diff / 86400000)}${t("daysRemaining")}` : t("expired"); })() : t("permanent")}
                    </span>
                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "#c0392b", fontSize: "var(--bubble-font-size, 14px)", padding: "0 4px", lineHeight: 1 }} onClick={() => {
                      const removed = bannedWords[i];
                      const next = bannedWords.filter((_, j) => j !== i);
                      setBannedWords(next);
                      localStorage.setItem(`bannedWords_${channelId}`, JSON.stringify(next));
                      if (removed) adminAction("remove-banned-word", channelId, { word: removed.word });
                    }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <input
                style={{ flex: 1, minWidth: 0, background: "var(--card)", border: "1.5px solid var(--input-border)", borderRadius: "10px", padding: "8px 12px", fontSize: "var(--bubble-font-size, 14px)", fontFamily: "inherit", color: "var(--gray-text)", outline: "none" }}
                type="text"
                placeholder={t("addBannedWord")}
                value={bannedInput}
                onChange={(e) => setBannedInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); addBannedWord(); } }}
              />
              <select
                style={{ background: "var(--card)", border: "1.5px solid var(--input-border)", borderRadius: "8px", padding: "6px 8px", fontSize: "calc(var(--bubble-font-size) - 2px)", fontFamily: "inherit", color: "var(--gray-text)", cursor: "pointer", flexShrink: 0 }}
                value={bannedDuration}
                onChange={(e) => setBannedDuration(e.target.value)}
              >
                <option value="">{ t("permanent")}</option>
                <option value="1">{ t("days1")}</option>
                <option value="7">{ t("days7")}</option>
                <option value="30">{ t("days30")}</option>
              </select>
              <button
                style={{ width: "calc(var(--bubble-font-size) + 19px)", height: "calc(var(--bubble-font-size) + 19px)", borderRadius: "50%", border: "none", background: "var(--bubble-sent, #3b8df0)", color: "#fff", fontSize: "var(--bubble-font-size)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                onClick={addBannedWord}
              >+</button>
            </div>
          </div>
        )}

        {/* Blocked users panel */}
        {view === "blocked" && (
          <div style={{ padding: "8px 0", maxHeight: "300px", overflowY: "auto" }}>
            {blockedUsers.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--meta)", fontSize: "var(--bubble-font-size, 14px)" }}>{ t("noBlockedUsers")}</div>
            ) : blockedUsers.map((blocked, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "0.5px solid var(--hairline)", gap: "10px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px", flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: "var(--bubble-font-size, 14px)", fontWeight: 400 }}>{t("anon")}#{blocked.uid.slice(-4)}</span>
                  {blocked.reason && <span style={{ fontSize: "calc(var(--bubble-font-size) - 2px)", color: "var(--meta)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>&quot;{blocked.reason}&quot;</span>}
                </div>
                <button
                  style={{ background: "none", border: "1px solid #d32f2f", color: "#d32f2f", fontSize: "calc(var(--bubble-font-size) - 3px)", fontWeight: 400, padding: "5px 10px", borderRadius: "8px", cursor: "pointer", fontFamily: "inherit" }}
                  onClick={() => onUnblock(blocked.uid)}
                >
                  {t("unblock")}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Welcome popup editor */}
        {view === "welcome" && (
          <div style={{ padding: "12px 18px", maxHeight: "60vh", overflowY: "auto" }}>
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "var(--bubble-font-size, 15px)", color: "var(--gray-text)", fontWeight: 400, marginBottom: "8px" }}>{ t("welcomeIcon")}</label>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {/* Preview */}
                <div style={{ width: "48px", height: "48px", borderRadius: "12px", border: "1.5px dashed var(--hairline)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, background: "var(--card)" }}>
                  {(welcomeIcon.startsWith("http") || (!welcomeIcon && profileImage))
                    ? <img src={welcomeIcon || profileImage || ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: "28px" }}>{welcomeIcon || "💬"}</span>
                  }
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                  <input value={welcomeIcon.startsWith("http") ? "" : welcomeIcon} onChange={(e) => setWelcomeIcon(e.target.value)} style={{ ...inputStyle, marginBottom: 0, fontSize: "var(--bubble-font-size)" }} placeholder={t("welcomeIconPlaceholder")} maxLength={4} />
                  <button
                    type="button"
                    style={{ background: "var(--card)", border: "1px solid var(--input-border)", borderRadius: "8px", padding: "6px 10px", fontSize: "calc(var(--bubble-font-size) - 3px)", cursor: "pointer", fontFamily: "inherit", color: "var(--card-text)", lineHeight: 1 }}
                    onClick={() => document.getElementById("welcomeIconInput")?.click()}
                  >{ t("welcomeUpload")}</button>
                  <input id="welcomeIconInput" type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    e.target.value = "";
                    const url = await uploadAdminImage(file, channelId);
                    if (url) setWelcomeIcon(url);
                  }} />
                </div>
              </div>
            </div>
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "var(--bubble-font-size, 15px)", color: "var(--gray-text)", fontWeight: 400, marginBottom: "8px" }}>{ t("welcomeTitleLabel")}</label>
              <input value={welcomeTitle} onChange={(e) => setWelcomeTitle(e.target.value)} style={{ ...inputStyle, marginBottom: 0, fontSize: "var(--bubble-font-size)" }} placeholder={t("welcomeTitlePlaceholder")} />
            </div>
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "var(--bubble-font-size, 15px)", color: "var(--gray-text)", fontWeight: 400, marginBottom: "8px" }}>{t("welcomeItemsLabel")}</label>
              <textarea value={welcomeItems} onChange={(e) => setWelcomeItems(e.target.value)} rows={5} style={{ ...inputStyle, marginBottom: 0, resize: "vertical", lineHeight: 1.5, fontSize: "var(--bubble-font-size)" }} placeholder={t("welcomeItemsPlaceholder")} />
            </div>
            <button style={saveBtnStyle} onClick={() => {
              const config = JSON.stringify({
                icon: welcomeIcon.trim(),
                title: welcomeTitle.trim() || t("welcomeTitlePlaceholder"),
                items: welcomeItems.split("\n").map((s: string) => s.trim()).filter(Boolean),
              });
              onWelcomeChange(config);
              goBack();
            }}>{ t("save")}</button>
          </div>
        )}

        {/* Guide panel */}
        {view === "guide" && (
          <div style={{ padding: "16px 14px 18px", maxHeight: "65vh", overflowY: "auto" }}>
            {[
              {
                title: t("guideOpenAdmin"),
                entries: [{ title: t("guideOpenAdmin"), description: t("guideOpenAdminDesc"), icon: "⚙" }],
              },
              {
                title: t("guideChannelTitle"),
                entries: [
                  { ...guideParts(t("guideProfile")), icon: "☺" },
                  { ...guideParts(t("guideColor")), icon: "●" },
                  { ...guideParts(t("guideBackground")), icon: "▧" },
                  { ...guideParts(t("guidePasscode")), icon: "⌨" },
                  { ...guideParts(t("guideRules")), icon: "ℹ" },
                  { ...guideParts(t("guideWelcome")), icon: "✦" },
                ],
              },
              {
                title: t("guideManageTitle"),
                entries: [
                  { ...guideParts(t("guideDmPrivacy")), icon: "✉" },
                  { ...guideParts(t("guideReport")), icon: "⚑" },
                  { ...guideParts(t("guideBlock")), icon: "⊘" },
                  { ...guideParts(t("guideUnblock")), icon: "↺" },
                  { ...guideParts(t("guidePetition")), icon: "!" },
                  { ...guideParts(t("guideBannedWords")), icon: "Aa" },
                  { ...guideParts(t("guideDelete")), icon: "⌫" },
                ],
              },
              {
                title: t("guideSpecialTitle"),
                entries: [
                  { ...guideParts(t("guideFreeze")), icon: "❄" },
                  { ...guideParts(t("guideLive")), icon: "◉" },
                ],
              },
            ].map((section, sectionIndex) => (
              <section key={`${section.title}-${sectionIndex}`} style={{ marginBottom: "18px" }}>
                {sectionIndex > 0 && <h4 style={{ margin: "0 0 7px 4px", fontSize: "calc(var(--bubble-font-size) - 4px)", fontWeight: 600, color: "var(--meta)" }}>{section.title}</h4>}
                <div style={{ borderRadius: "15px", overflow: "hidden", background: "var(--card)" }}>
                  {section.entries.map((entry, index) => (
                    <div key={`${entry.title}-${index}`} style={{ display: "flex", gap: "11px", padding: "13px 12px", borderBottom: index < section.entries.length - 1 ? "0.5px solid var(--hairline)" : "none" }}>
                      <span style={{ width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--bubble-sent) 12%, var(--bg))", color: "var(--bubble-sent)", fontSize: entry.icon === "Aa" ? "11px" : "14px", fontWeight: 600 }}>{entry.icon}</span>
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
        )}
      </div>
      {cropFile && (
        <ProfileImageCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={(file, preview) => {
            setProfileImageFile(file);
            setProfileImagePreview(preview);
            setCropFile(null);
          }}
        />
      )}
    </div>
  );
}
