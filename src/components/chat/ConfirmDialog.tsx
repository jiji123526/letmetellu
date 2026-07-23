"use client";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel = "확인", confirmColor, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.4)", padding: "24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{ width: "100%", maxWidth: "300px", background: "var(--bg)", borderRadius: "16px", padding: "20px" }}>
        <div style={{ fontSize: "var(--bubble-font-size, 16px)", fontWeight: 500, color: "var(--gray-text)", marginBottom: "12px" }}>{title}</div>
        <div style={{ fontSize: "var(--bubble-font-size, 14px)", color: "var(--meta)", marginBottom: "16px", lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: message }} />
        <div style={{ display: "flex", gap: "8px" }}>
          <button style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: "#f4f4f4", color: "#666" }} onClick={onCancel}>취소</button>
          <button style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: "pointer", fontFamily: "inherit", lineHeight: 1, background: confirmColor || "var(--bubble-sent, #3b8df0)", color: "#fff" }} onClick={() => { onConfirm(); }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
