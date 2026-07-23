"use client";

import { useEffect, useRef } from "react";

interface PlusMenuProps {
  anchorRect: DOMRect;
  dmMode: boolean;
  dmEnabled: boolean;
  onPhoto: () => void;
  onDmToggle: () => void;
  onClose: () => void;
}

const ITEMS = [
  {
    key: "dm",
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  },
  {
    key: "photo",
    label: "사진 보내기",
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  },
];

export function PlusMenu({ anchorRect, dmMode, dmEnabled, onPhoto, onDmToggle, onClose }: PlusMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener("click", handler), 10);
    return () => document.removeEventListener("click", handler);
  }, [onClose]);

  const itemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    border: "none",
    background: "none",
    color: "var(--gray-text)",
    fontSize: "var(--bubble-font-size, 17px)",
    fontFamily: "inherit",
    padding: "12px 16px",
    textAlign: "left",
    cursor: "pointer",
    borderBottom: "0.5px solid var(--hairline)",
    whiteSpace: "nowrap",
    lineHeight: 1,
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[110] rounded-[14px] overflow-hidden animate-[ctxPop_0.15s_ease]"
      style={{
        bottom: window.innerHeight - anchorRect.top + 8,
        left: anchorRect.left,
        background: "var(--header-bg)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        boxShadow: "0 4px 20px rgba(0,0,0,.15)",
      }}
    >
      {dmEnabled && (
        <button style={itemStyle} onClick={() => { onDmToggle(); onClose(); }}>
          <span className="flex-shrink-0" dangerouslySetInnerHTML={{ __html: ITEMS[0].icon }} />
          {dmMode ? "일반 채팅으로 전환" : "비밀 메시지"}
        </button>
      )}
      <button style={{ ...itemStyle, borderBottom: "none" }} onClick={() => { onPhoto(); onClose(); }}>
        <span className="flex-shrink-0" dangerouslySetInnerHTML={{ __html: ITEMS[1].icon }} />
        사진 보내기
      </button>
    </div>
  );
}
