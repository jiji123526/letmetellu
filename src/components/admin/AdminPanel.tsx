"use client";

import { useState, useRef } from "react";

interface AdminPanelProps {
  channelId: string;
  channelName: string;
  profileImage: string | null;
  currentColor: string;
  isFrozen: boolean;
  liveActive: boolean;
  petitionEnabled: boolean;
  dmEnabled: boolean;
  notice: string;
  blockedUsers: { uid: string; reason: string }[];
  onFreeze: () => void;
  onUnfreeze: () => void;
  onLive: () => void;
  onToggleView: () => void;
  onPetitionToggle: () => void;
  onDmToggle: () => void;
  onColorChange: (color: string) => void;
  onNameChange: (name: string) => void;
  onProfileImageChange: (url: string) => void;
  onNoticeChange: (notice: string) => void;
  onWelcomeChange: (config: string) => void;
  welcomeConfig: string;
  onUnblock: (uid: string) => void;
  onClose: () => void;
}

type PanelView = "main" | "channel" | "manage" | "profile" | "color" | "passcode" | "rules" | "welcome" | "banned-words" | "blocked" | "guide";

const BUBBLE_COLORS = ["#3b8df0", "#9b59b6", "#2e7d32", "#e74c3c", "#f39c12", "#1abc9c", "#e91e63"];

function darkenColor(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
}

interface MenuItem { key: string; label: string; icon: string; arrow: string; arrowColor?: string; }

export function AdminPanel(props: AdminPanelProps) {
  const { channelId, channelName, profileImage, currentColor, isFrozen, liveActive, petitionEnabled, dmEnabled, notice, welcomeConfig, blockedUsers, onFreeze, onUnfreeze, onLive, onToggleView, onPetitionToggle, onDmToggle, onColorChange, onNameChange, onProfileImageChange, onNoticeChange, onWelcomeChange, onUnblock, onClose } = props;
  const [view, setView] = useState<PanelView>("main");
  const [nameInput, setNameInput] = useState(channelName);
  const [selectedColor, setSelectedColor] = useState(currentColor);
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
    try { const p = JSON.parse(welcomeConfig || "{}"); return p.icon || "💬"; } catch { return "💬"; }
  });
  const [welcomeTitle, setWelcomeTitle] = useState(() => {
    try { const p = JSON.parse(welcomeConfig || "{}"); return p.title || "환영합니다!"; } catch { return "환영합니다!"; }
  });
  const [welcomeItems, setWelcomeItems] = useState(() => {
    try { const p = JSON.parse(welcomeConfig || "{}"); return (p.items || []).join("\n"); } catch { return ""; }
  });
  const colorInputRef = useRef<HTMLInputElement>(null);

  const mainItems: MenuItem[] = [
    { key: "channel", label: "채널", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>`, arrow: "›" },
    { key: "manage", label: "관리", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`, arrow: "›" },
    { key: "freeze", label: isFrozen ? "채팅 해제" : "채팅 얼리기", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M17 7l-10 10M2 12h20M7 7l10 10"/></svg>`, arrow: "●", arrowColor: isFrozen ? "#4a4d8f" : undefined },
    { key: "live", label: liveActive ? "라이브 종료" : "라이브 시작", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M4.93 4.93a10 10 0 0 1 14.14 0"/><path d="M7.76 7.76a6 6 0 0 1 8.48 0"/></svg>`, arrow: "●", arrowColor: liveActive ? "#c0392b" : undefined },
    { key: "guide", label: "사용 가이드", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`, arrow: "›" },
    { key: "toggle-view", label: "사용자 시점으로 보기", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`, arrow: "›" },
  ];

  const channelItems: MenuItem[] = [
    { key: "profile", label: "채널 프로필", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`, arrow: "›" },
    { key: "color", label: "채널 기본 색상", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="8" r="2" fill="currentColor"/><circle cx="8" cy="14" r="2" fill="currentColor"/><circle cx="16" cy="14" r="2" fill="currentColor"/></svg>`, arrow: "›" },
    { key: "passcode", label: "채널 비밀번호", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`, arrow: "›" },
    { key: "rules", label: "채널 규칙", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></svg>`, arrow: "›" },
    { key: "welcome", label: "환영 팝업", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`, arrow: "›" },
  ];

  const manageItems: MenuItem[] = [
    { key: "banned-words", label: "금지어", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18.36 5.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`, arrow: "›" },
    { key: "blocked", label: "차단 사용자", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg>`, arrow: "›" },
    { key: "petition-toggle", label: petitionEnabled ? "이의 제기 허용 중" : "이의 제기 차단 중", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`, arrow: "●", arrowColor: petitionEnabled ? "#2a9d4e" : "#c0392b" },
    { key: "dm-toggle", label: dmEnabled ? "비밀 메시지 허용 중" : "비밀 메시지 차단 중", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`, arrow: "●", arrowColor: dmEnabled ? "#2a9d4e" : "#c0392b" },
  ];

  const handleClick = (key: string) => {
    switch (key) {
      case "channel": setView("channel"); break;
      case "manage": setView("manage"); break;
      case "profile": setView("profile"); break;
      case "color": setView("color"); break;
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
    if (view === "profile" || view === "color" || view === "passcode" || view === "rules" || view === "welcome") setView("channel");
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

  const title = { main: "관리자 설정", channel: "채널", manage: "관리", profile: "채널 프로필", color: "채널 기본 색상", passcode: "채널 비밀번호", rules: "채널 규칙", welcome: "환영 팝업", "banned-words": "금지어", blocked: "차단된 사용자", guide: "사용 가이드" }[view];

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
                style={{ width: "80px", height: "80px", borderRadius: "20px", overflow: "hidden", border: "2px dashed var(--hairline)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f8f8" }}
                onClick={() => document.getElementById("profileImgInput")?.click()}
              >
                {profileImage ? (
                  <img src={profileImage} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: "28px" }}>💬</span>
                )}
              </div>
              <button
                style={{ background: "#f4f4f4", border: "1px solid #e0e0e0", borderRadius: "10px", padding: "8px 16px", fontSize: "calc(var(--bubble-font-size) - 5px)", cursor: "pointer", fontFamily: "inherit", color: "#555" }}
                onClick={() => document.getElementById("profileImgInput")?.click()}
              >
                사진 변경
              </button>
              <input id="profileImgInput" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const url = URL.createObjectURL(file);
                onProfileImageChange(url);
                e.target.value = "";
              }} />
            </div>

            {/* Channel name */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--meta)", fontWeight: 700, marginBottom: "8px" }}>채널 이름</div>
              <input
                style={{ width: "100%", background: "#f8f8f8", border: "1.5px solid #e0e0e0", borderRadius: "12px", padding: "11px 14px", fontSize: "calc(var(--bubble-font-size) - 3px)", color: "var(--gray-text)", fontFamily: "inherit", boxSizing: "border-box" as const, outline: "none" }}
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={20}
              />
            </div>

            <button style={saveBtnStyle} onClick={() => { onNameChange(nameInput); goBack(); }}>저장</button>
          </div>
        )}

        {/* Color panel */}
        {view === "color" && (
          <div style={{ padding: "12px 18px" }}>
            <div style={{ fontSize: "13px", color: "var(--meta)", textAlign: "center", marginBottom: "16px" }}>이 채널의 기본 말풍선 색상을 설정합니다</div>
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

        {/* Passcode panel */}
        {view === "passcode" && (
          <div style={{ padding: "12px 18px" }}>
            <div style={{ fontSize: "13px", color: "var(--meta)", marginBottom: "6px" }}>현재 채널: {channelName}</div>
            <input style={inputStyle} type="text" placeholder="새 비밀번호 입력" autoComplete="off" />
            <div style={{ fontSize: "11px", color: "var(--meta)", marginBottom: "12px" }}>비우면 비밀번호 해제</div>
            <button style={saveBtnStyle} onClick={goBack}>저장</button>
          </div>
        )}

        {/* Rules panel */}
        {view === "rules" && (
          <div style={{ padding: "12px 18px", maxHeight: "60vh", overflowY: "auto" }}>
            {rules.map((section, i) => (
              <div key={i} style={{ marginBottom: "16px", padding: "12px", borderRadius: "12px", border: "1px solid var(--hairline)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                  <input style={{ ...inputStyle, flex: 1, marginRight: "8px", marginBottom: 0 }} value={section.title} placeholder="섹션 제목" onChange={(e) => { const r = [...rules]; r[i] = { ...r[i], title: e.target.value }; setRules(r); }} />
                  <button style={{ background: "none", border: "none", color: "#c0392b", cursor: "pointer", fontSize: "18px" }} onClick={() => setRules(rules.filter((_, j) => j !== i))}>✕</button>
                </div>
                <textarea style={{ ...inputStyle, marginBottom: 0, resize: "vertical" }} rows={3} placeholder="항목 (한 줄에 하나씩)" value={section.items.join("\n")} onChange={(e) => { const r = [...rules]; r[i] = { ...r[i], items: e.target.value.split("\n") }; setRules(r); }} />
              </div>
            ))}
            <button style={{ ...saveBtnStyle, background: "#f4f4f4", color: "#666", marginBottom: "12px" }} onClick={() => setRules([...rules, { title: "", items: [] }])}>+ 섹션 추가</button>
            <button style={saveBtnStyle} onClick={() => { const cleaned = rules.filter(s => s.title.trim() || s.items.some(i => i.trim())).map(s => ({ title: s.title.trim(), items: s.items.map(i => i.trim()).filter(Boolean) })); onNoticeChange(JSON.stringify(cleaned)); goBack(); }}>저장</button>
          </div>
        )}

        {/* Banned words panel */}
        {view === "banned-words" && (
          <div style={{ padding: "12px 18px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "12px", maxHeight: "200px", overflowY: "auto" }}>
              {bannedWords.length === 0 ? (
                <div style={{ color: "var(--meta)", fontSize: "var(--bubble-font-size, 13px)", textAlign: "center", padding: "12px 0" }}>등록된 금지어가 없습니다</div>
              ) : bannedWords.map((w, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#f4f4f4", borderRadius: "10px" }}>
                  <span style={{ fontSize: "var(--bubble-font-size, 14px)", color: "var(--gray-text)" }}>{w.word}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--meta)" }}>
                      {w.expires ? (() => { const diff = new Date(w.expires).getTime() - Date.now(); return diff > 0 ? `${Math.ceil(diff / 86400000)}일 남음` : "만료됨"; })() : "영구"}
                    </span>
                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "#c0392b", fontSize: "var(--bubble-font-size, 14px)", padding: "0 4px", lineHeight: 1 }} onClick={() => {
                      const next = bannedWords.filter((_, j) => j !== i);
                      setBannedWords(next);
                      localStorage.setItem(`bannedWords_${channelId}`, JSON.stringify(next));
                    }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <input
                style={{ flex: 1, minWidth: 0, background: "#f4f4f4", border: "1.5px solid #e0e0e0", borderRadius: "10px", padding: "8px 12px", fontSize: "var(--bubble-font-size, 14px)", fontFamily: "inherit", color: "var(--gray-text)", outline: "none" }}
                type="text"
                placeholder="금지어 추가..."
                value={bannedInput}
                onChange={(e) => setBannedInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); addBannedWord(); } }}
              />
              <select
                style={{ background: "#f4f4f4", border: "1.5px solid #e0e0e0", borderRadius: "8px", padding: "6px 8px", fontSize: "calc(var(--bubble-font-size) - 2px)", fontFamily: "inherit", color: "var(--gray-text)", cursor: "pointer", flexShrink: 0 }}
                value={bannedDuration}
                onChange={(e) => setBannedDuration(e.target.value)}
              >
                <option value="">영구</option>
                <option value="1">1일</option>
                <option value="7">7일</option>
                <option value="30">30일</option>
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
              <div style={{ padding: "24px", textAlign: "center", color: "var(--meta)", fontSize: "var(--bubble-font-size, 14px)" }}>차단된 사용자가 없습니다</div>
            ) : blockedUsers.map((blocked, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "0.5px solid var(--hairline)", gap: "10px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px", flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: "var(--bubble-font-size, 14px)", fontWeight: 400 }}>익명#{blocked.uid.slice(-4)}</span>
                  {blocked.reason && <span style={{ fontSize: "calc(var(--bubble-font-size) - 2px)", color: "var(--meta)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>&quot;{blocked.reason}&quot;</span>}
                </div>
                <button
                  style={{ background: "none", border: "1px solid #d32f2f", color: "#d32f2f", fontSize: "calc(var(--bubble-font-size) - 3px)", fontWeight: 400, padding: "5px 10px", borderRadius: "8px", cursor: "pointer", fontFamily: "inherit" }}
                  onClick={() => onUnblock(blocked.uid)}
                >
                  차단 해제
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Welcome popup editor */}
        {view === "welcome" && (
          <div style={{ padding: "12px 18px", maxHeight: "60vh", overflowY: "auto" }}>
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--meta)", fontWeight: 600, marginBottom: "6px" }}>아이콘 (이모지 또는 이미지)</label>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {/* Preview */}
                <div style={{ width: "48px", height: "48px", borderRadius: "12px", border: "1.5px dashed var(--hairline)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, background: "#f8f8f8" }}>
                  {welcomeIcon.startsWith("http") || welcomeIcon.startsWith("blob:") || welcomeIcon.startsWith("data:")
                    ? <img src={welcomeIcon} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: "28px" }}>{welcomeIcon || "💬"}</span>
                  }
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                  <input value={welcomeIcon.startsWith("http") || welcomeIcon.startsWith("blob:") || welcomeIcon.startsWith("data:") ? "" : welcomeIcon} onChange={(e) => setWelcomeIcon(e.target.value)} style={{ ...inputStyle, marginBottom: 0, fontSize: "var(--bubble-font-size)" }} placeholder="이모지 입력" maxLength={4} />
                  <button
                    type="button"
                    style={{ background: "#f4f4f4", border: "1px solid #e0e0e0", borderRadius: "8px", padding: "6px 10px", fontSize: "calc(var(--bubble-font-size) - 3px)", cursor: "pointer", fontFamily: "inherit", color: "#555", lineHeight: 1 }}
                    onClick={() => document.getElementById("welcomeIconInput")?.click()}
                  >사진 업로드</button>
                  <input id="welcomeIconInput" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const url = URL.createObjectURL(file);
                    setWelcomeIcon(url);
                    e.target.value = "";
                  }} />
                </div>
              </div>
            </div>
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--meta)", fontWeight: 600, marginBottom: "6px" }}>제목</label>
              <input value={welcomeTitle} onChange={(e) => setWelcomeTitle(e.target.value)} style={{ ...inputStyle, marginBottom: 0, fontSize: "var(--bubble-font-size)" }} placeholder="환영합니다!" />
            </div>
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--meta)", fontWeight: 600, marginBottom: "6px" }}>안내 항목 (한 줄에 하나씩)</label>
              <textarea value={welcomeItems} onChange={(e) => setWelcomeItems(e.target.value)} rows={5} style={{ ...inputStyle, marginBottom: 0, resize: "vertical", lineHeight: 1.5, fontSize: "var(--bubble-font-size)" }} placeholder="메시지를 꾹 누르면 답장, 리액션, 신고가 가능합니다" />
            </div>
            <button style={saveBtnStyle} onClick={() => {
              const config = JSON.stringify({
                icon: welcomeIcon.trim() || "💬",
                title: welcomeTitle.trim() || "환영합니다!",
                items: welcomeItems.split("\n").map((s: string) => s.trim()).filter(Boolean),
              });
              onWelcomeChange(config);
              goBack();
            }}>저장</button>
          </div>
        )}

        {/* Guide panel */}
        {view === "guide" && (
          <div style={{ padding: "12px 18px", fontSize: "13px", lineHeight: 1.6, color: "#444", maxHeight: "60vh", overflowY: "auto" }}>
            <div style={{ marginBottom: "16px" }}>
              <h4 style={{ fontWeight: 500, margin: "0 0 8px", color: "#222" }}>관리자 설정 열기</h4>
              <p style={{ color: "#888", margin: 0 }}>우측 상단 ⋮ 메뉴 → 관리자 설정에서 모든 채널 설정을 관리할 수 있습니다.</p>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <h4 style={{ fontWeight: 500, margin: "0 0 8px", color: "#222" }}>채널 설정</h4>
              <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "6px", margin: 0, color: "#888" }}>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>프로필</strong> — 채널 이름과 프로필 사진 변경. 정사각형 크롭 후 업로드</li>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>색상</strong> — 말풍선 기본 색상. 7가지 프리셋 또는 커스텀</li>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>비밀번호</strong> — 설정하면 입장 시 비밀번호 필요. 비우면 해제</li>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>규칙</strong> — ℹ️ 버튼에 표시되는 채널 규칙. 여러 섹션 추가 가능</li>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>환영 팝업</strong> — 첫 방문자에게 표시되는 안내 팝업. 아이콘, 제목, 항목 커스텀 가능</li>
              </ul>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <h4 style={{ fontWeight: 500, margin: "0 0 8px", color: "#222" }}>사용자 관리</h4>
              <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "6px", margin: 0, color: "#888" }}>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>신고 접수</strong> — 사용자가 메시지를 꾹 눌러 신고하면 🚨 표시로 나타남</li>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>차단</strong> — 메시지를 꾹 눌러 즉시 차단. UID + 기기 지문으로 식별</li>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>차단 해제</strong> — 관리 → 차단 사용자에서 해제 가능</li>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>이의 제기</strong> — 차단된 사용자의 1회 DM 허용. 관리에서 끄기 가능</li>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>금지어</strong> — 특정 단어 포함 메시지 자동 차단. 기간 설정 가능</li>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>메시지 삭제</strong> — 꾹 눌러 삭제. 답장도 함께 삭제됨</li>
              </ul>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <h4 style={{ fontWeight: 500, margin: "0 0 8px", color: "#222" }}>특수 기능</h4>
              <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "6px", margin: 0, color: "#888" }}>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>얼리기</strong> — 일반 채팅 중단. 관리자만 보낼 수 있고 사용자는 DM만 가능</li>
                <li>• <strong style={{ fontWeight: 500, color: "#555" }}>라이브</strong> — 임시 세션 시작. 종료 시 모든 메시지 자동 삭제</li>
              </ul>
            </div>
            <div style={{ padding: "10px 12px", background: "#f0f7ff", borderRadius: "10px", fontSize: "12px", color: "#3b8df0", lineHeight: 1.5 }}>
              💡 채널 주소를 공유하면 누구나 익명으로 참여할 수 있습니다.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
