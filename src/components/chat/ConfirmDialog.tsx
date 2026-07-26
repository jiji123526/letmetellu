"use client";

import { useLocale } from "@/hooks/useLocale";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
  showCancel?: boolean;
  closeOnBackdrop?: boolean;
  disabled?: boolean;
}

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, confirmColor, onConfirm, onCancel, showCancel = true, closeOnBackdrop = true, disabled = false }: ConfirmDialogProps) {
  const { t } = useLocale();
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.4)", padding: "24px" }}
      onClick={(e) => { if (!disabled && closeOnBackdrop && e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{ width: "100%", maxWidth: "300px", background: "var(--bg, #fff)", borderRadius: "18px", padding: "22px 20px 18px", boxShadow: "0 18px 50px rgba(0,0,0,.22)", textAlign: "center" }}>
        <div style={{ fontSize: "var(--bubble-font-size, 17px)", fontWeight: 600, color: "var(--gray-text, #111)", marginBottom: "9px" }}>{title}</div>
        <div style={{ fontSize: "calc(var(--bubble-font-size, 16px) - 2px)", color: "var(--meta, #8e8e93)", marginBottom: "18px", lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: message }} />
        <div style={{ display: "flex", gap: "8px" }}>
          {showCancel && <button disabled={disabled} style={{ flex: 1, border: "none", borderRadius: "12px", padding: "12px", fontSize: "calc(var(--bubble-font-size, 16px) - 2px)", cursor: disabled ? "wait" : "pointer", fontFamily: "inherit", lineHeight: 1, background: "var(--card, #f2f2f7)", color: "var(--secondary-text, #3c3c43)", opacity: disabled ? 0.65 : 1 }} onClick={onCancel}>{cancelLabel || t("cancel")}</button>}
          <button disabled={disabled} style={{ flex: 1, border: "none", borderRadius: "12px", padding: "11px", fontSize: "var(--bubble-font-size, 14px)", cursor: disabled ? "wait" : "pointer", fontFamily: "inherit", lineHeight: 1, background: confirmColor || "var(--bubble-sent, #3b8df0)", color: "#fff", opacity: disabled ? 0.65 : 1 }} onClick={() => { onConfirm(); }}>{confirmLabel || t("confirm")}</button>
        </div>
      </div>
    </div>
  );
}
