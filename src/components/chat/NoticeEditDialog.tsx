"use client";

import { useState, useEffect, useRef } from "react";

interface NoticeEditDialogProps {
  currentTitle: string;
  currentBody: string;
  onSave: (title: string, body: string) => void;
  onClose: () => void;
}

export function NoticeEditDialog({ currentTitle, currentBody, onSave, onClose }: NoticeEditDialogProps) {
  const [title, setTitle] = useState(currentTitle);
  const [body, setBody] = useState(currentBody);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.4)", padding: "24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "100%", maxWidth: "300px", background: "var(--bg)", borderRadius: "16px", padding: "20px" }}>
        <div style={{ fontSize: "var(--bubble-font-size, 16px)", fontWeight: 500, color: "var(--gray-text)", marginBottom: "12px" }}>공지 설정</div>

        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="공지 제목 (비우면 공지 삭제)"
          style={{ width: "100%", background: "#f4f4f4", border: "1.5px solid #e0e0e0", borderRadius: "12px", padding: "11px 14px", fontSize: "var(--bubble-font-size, 14px)", fontFamily: "inherit", color: "var(--gray-text)", boxSizing: "border-box" as const, marginBottom: "8px", outline: "none", lineHeight: 1 }}
          onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--bubble-sent, #3b8df0)"; }}
          onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "#e0e0e0"; }}
        />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="공지 내용 (선택사항)"
          style={{ width: "100%", background: "#f4f4f4", border: "1.5px solid #e0e0e0", borderRadius: "12px", padding: "11px 14px", fontSize: "var(--bubble-font-size, 14px)", fontFamily: "inherit", color: "var(--gray-text)", resize: "none", lineHeight: 1.5, boxSizing: "border-box" as const, outline: "none" }}
          onFocus={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = "var(--bubble-sent, #3b8df0)"; }}
          onBlur={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = "#e0e0e0"; }}
        />

        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", background: "#f4f4f4", color: "#666", lineHeight: 1 }} onClick={onClose}>취소</button>
          <button style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", background: "var(--bubble-sent, #3b8df0)", color: "#fff", lineHeight: 1 }} onClick={() => { onSave(title.trim(), body.trim()); onClose(); }}>저장</button>
        </div>
      </div>
    </div>
  );
}
