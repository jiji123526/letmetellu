"use client";

import { useState, useEffect, useRef } from "react";
import { useLocale } from "@/hooks/useLocale";

interface EditDialogProps {
  currentText: string;
  onSave: (newText: string) => void;
  onClose: () => void;
  inline?: boolean;
}

export function EditDialog({ currentText, onSave, onClose, inline = false }: EditDialogProps) {
  const { t } = useLocale();
  const [text, setText] = useState(currentText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const panel = (
    <div
      style={{
        width: "100%",
        maxWidth: inline ? "none" : "300px",
        background: "var(--bg)",
        borderRadius: "16px",
        padding: "20px",
        border: inline ? "1px solid color-mix(in srgb, var(--gray-text) 10%, transparent)" : undefined,
        boxShadow: inline ? "0 12px 30px rgba(0,0,0,.08)" : undefined,
      }}
    >
      {/* Title */}
      <div style={{ fontSize: "var(--bubble-font-size, 16px)", fontWeight: 500, color: "var(--gray-text)", marginBottom: "12px" }}>
        {t("editMessageTitle")}
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        style={{
          width: "100%",
          background: "var(--card)",
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
          style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "var(--card)", color: "var(--secondary-text)" }}
          onClick={onClose}
        >
          {t("cancel")}
        </button>
        <button
          style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "var(--bubble-sent, #3b8df0)", color: "#fff" }}
          onClick={() => { if (text.trim()) { onSave(text.trim()); onClose(); } }}
        >
          {t("save")}
        </button>
      </div>
    </div>
  );

  if (inline) {
    return panel;
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.4)", padding: "24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {panel}
    </div>
  );
}
