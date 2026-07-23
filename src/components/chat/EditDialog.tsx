"use client";

import { useState, useEffect, useRef } from "react";

interface EditDialogProps {
  currentText: string;
  onSave: (newText: string) => void;
  onClose: () => void;
}

export function EditDialog({ currentText, onSave, onClose }: EditDialogProps) {
  const [text, setText] = useState(currentText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.4)", padding: "24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "100%", maxWidth: "300px", background: "var(--bg)", borderRadius: "16px", padding: "20px" }}>
        {/* Title */}
        <div style={{ fontSize: "var(--bubble-font-size, 16px)", fontWeight: 500, color: "var(--gray-text)", marginBottom: "12px" }}>
          메시지 수정
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          style={{
            width: "100%",
            background: "#f4f4f4",
            border: "1.5px solid #e0e0e0",
            borderRadius: "12px",
            padding: "11px 14px",
            fontSize: "var(--bubble-font-size, 14px)",
            fontFamily: "inherit",
            color: "var(--gray-text)",
            resize: "none",
            lineHeight: 1.5,
            boxSizing: "border-box",
            outline: "none",
          }}
          onFocus={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = "var(--bubble-sent, #3b8df0)"; }}
          onBlur={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = "#e0e0e0"; }}
        />

        {/* Buttons */}
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button
            style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "#f4f4f4", color: "#666" }}
            onClick={onClose}
          >
            취소
          </button>
          <button
            style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "var(--bubble-sent, #3b8df0)", color: "#fff" }}
            onClick={() => { if (text.trim()) { onSave(text.trim()); onClose(); } }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
