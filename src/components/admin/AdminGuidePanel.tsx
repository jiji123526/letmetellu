"use client";

import { CloseIcon } from "@/components/ui/CloseIcon";
import { useLocale } from "@/hooks/useLocale";
import { AdminGuideContent } from "./AdminGuideContent";

export function AdminGuidePanel({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center animate-[ctxFade_0.2s_ease]"
      style={{ background: "rgba(0,0,0,.4)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", padding: "24px" }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div style={{ width: "100%", maxWidth: "320px", background: "var(--bg)", color: "var(--gray-text)", borderRadius: "16px", overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "0.5px solid var(--hairline)" }}>
          <h3 style={{ margin: 0, fontSize: "var(--bubble-font-size, 16px)", fontWeight: 500 }}>{t("guide")}</h3>
          <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--meta)", padding: "4px 8px" }} onClick={onClose}><CloseIcon /></button>
        </div>
        <AdminGuideContent />
      </div>
    </div>
  );
}
