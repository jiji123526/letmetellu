"use client";

import { useState } from "react";

interface NoticeBannerProps {
  channelId: string;
  notice: string; // raw notice text or JSON {title, body}
  onDismiss: () => void;
}

export function NoticeBanner({ channelId, notice, onDismiss }: NoticeBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (!notice) return null;

  // Check if dismissed
  if (typeof window !== "undefined") {
    const dismissed = localStorage.getItem(`noticeDismissed_${channelId}`);
    if (dismissed === notice) return null;
  }

  // Parse notice
  let title = notice;
  let body = "";
  try {
    const parsed = JSON.parse(notice);
    if (parsed.title) { title = parsed.title; body = parsed.body || ""; }
  } catch { /* plain text */ }

  const handleDismiss = () => {
    localStorage.setItem(`noticeDismissed_${channelId}`, notice);
    onDismiss();
  };

  return (
    <div style={{ margin: "8px", padding: "10px 14px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", background: "rgba(255,255,255,.95)", borderRadius: "14px", zIndex: 10, flexShrink: 0, boxShadow: "0 1px 4px rgba(0,0,0,.1)", lineHeight: 1 }}>
      {/* Megaphone icon */}
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", color: "var(--gray-text)", padding: "0 4px" }}>
        <svg viewBox="0 0 32 32" style={{ width: "24px", height: "24px" }} fill="currentColor">
          <path d="M5.063,19.369l0.521,4.602c0.007,0.067,0.021,0.133,0.042,0.197c0.412,1.266,1.591,2.072,2.855,2.072c0.308,0,0.619-0.048,0.927-0.148c1.572-0.512,2.436-2.208,1.924-3.781l-0.83-2.551h0.261l7.789,3.895c0.142,0.07,0.294,0.105,0.447,0.105c0.183,0,0.365-0.05,0.525-0.149C19.82,23.429,20,23.107,20,22.76v-4.142c1.721-0.447,3-2,3-3.858s-1.279-3.411-3-3.858V6.76c0-0.347-0.18-0.668-0.475-0.851c-0.295-0.183-0.663-0.199-0.973-0.044L10.764,9.76H7c-2.757,0-5,2.243-5,5C2,16.831,3.265,18.611,5.063,19.369z M9.43,22.93c0.171,0.524-0.116,1.089-0.641,1.26c-0.499,0.163-1.032-0.089-1.231-0.562L7.119,19.76h1.279L9.43,22.93z M21,14.76c0,0.737-0.405,1.375-1,1.722v-3.443C20.595,13.385,21,14.023,21,14.76z M18,21.142l-6-3v-6.764l6-3V21.142z M7,11.76h3v6H7c-1.654,0-3-1.346-3-3S5.346,11.76,7,11.76z" />
          <path d="M27,15.76h2c0.553,0,1-0.448,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.448-1,1S26.447,15.76,27,15.76z" />
          <path d="M27,10.467c0.256,0,0.512-0.098,0.707-0.293l1.414-1.414c0.391-0.391,0.391-1.023,0-1.414s-1.023-0.391-1.414,0L26.293,8.76c-0.391,0.391-0.391,1.023,0,1.414C26.488,10.37,26.744,10.467,27,10.467z" />
          <path d="M27.707,22.174c0.195,0.195,0.451,0.293,0.707,0.293s0.512-0.098,0.707-0.293c0.391-0.391,0.391-1.023,0-1.414l-1.414-1.414c-0.391-0.391-1.023-0.391-1.414,0s-0.391,1.023,0,1.414L27.707,22.174z" />
        </svg>
      </span>

      {/* Title */}
      <span style={{ flex: 1, fontSize: "var(--bubble-font-size, 14px)", fontWeight: 400, color: "var(--gray-text)", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: expanded ? "normal" : "nowrap" }}>
        {title}
      </span>

      {/* Expand button (if body exists) */}
      {body && (
        <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", fontSize: "var(--bubble-font-size, 16px)", padding: "0 4px", flexShrink: 0, lineHeight: 1 }} onClick={() => setExpanded(!expanded)}>
          {expanded ? "▲" : "▼"}
        </button>
      )}

      {/* Close button */}
      <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", fontSize: "var(--bubble-font-size, 16px)", padding: "0 4px", lineHeight: 1 }} onClick={handleDismiss}>
        ✕
      </button>

      {/* Expanded body */}
      {body && expanded && (
        <div style={{ width: "100%", fontSize: "calc(var(--bubble-font-size, 14px) - 1px)", color: "var(--meta)", lineHeight: 1.5, padding: "8px 0 0 36px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {body}
        </div>
      )}
    </div>
  );
}
