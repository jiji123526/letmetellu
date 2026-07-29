"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";

interface ModerationPetitionDialogProps {
  submitting: boolean;
  onSubmit: (text: string) => Promise<void> | void;
  onClose: () => void;
}

export function ModerationPetitionDialog({
  submitting,
  onSubmit,
  onClose,
}: ModerationPetitionDialogProps) {
  const { t } = useLocale();
  const [text, setText] = useState("");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting]);

  return (
    <div
      className="absolute inset-0 z-[320] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,.28)", padding: "64px 10px 10px" }}
      onClick={(event) => {
        if (!submitting && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "460px",
          maxHeight: "100%",
          background: "var(--bg, #fff)",
          borderRadius: "22px",
          boxShadow: "0 18px 50px rgba(0,0,0,.22)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            alignSelf: "center",
            width: "42px",
            height: "4px",
            borderRadius: "999px",
            background: "var(--hairline, #d1d1d6)",
            marginTop: "10px",
            marginBottom: "8px",
          }}
        />

        <div style={{ padding: "8px 16px 0", overflowY: "auto" }}>
          <div style={{ fontSize: "calc(var(--bubble-font-size, 17px) + 1px)", fontWeight: 600, color: "var(--gray-text, #111)", marginBottom: "8px" }}>
            {t("moderationPetitionTitle")}
          </div>
          <div style={{ fontSize: "calc(var(--bubble-font-size, 16px) - 2px)", color: "var(--meta, #8e8e93)", lineHeight: 1.5, marginBottom: "16px" }}>
            {t("moderationPetitionDescription")}
          </div>

          <textarea
            value={text}
            maxLength={500}
            disabled={submitting}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("moderationPetitionPlaceholder")}
            style={{
              width: "100%",
              minHeight: "132px",
              resize: "vertical",
              borderRadius: "14px",
              border: "1px solid var(--hairline, #d1d1d6)",
              padding: "12px 13px",
              fontFamily: "inherit",
              fontSize: "calc(var(--bubble-font-size, 16px) - 2px)",
              color: "var(--gray-text, #111)",
              background: "var(--card, #f2f2f7)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ marginTop: "8px", marginBottom: "16px", textAlign: "right", fontSize: "12px", color: "var(--meta, #8e8e93)" }}>
            {text.length}/500
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "12px 16px 16px",
            borderTop: "0.5px solid var(--hairline, #d1d1d6)",
            background: "var(--bg, #fff)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            style={{
              flex: 1,
              border: "none",
              borderRadius: "12px",
              padding: "12px",
              fontSize: "calc(var(--bubble-font-size, 16px) - 2px)",
              cursor: submitting ? "wait" : "pointer",
              fontFamily: "inherit",
              lineHeight: 1,
              background: "var(--card, #f2f2f7)",
              color: "var(--secondary-text, #3c3c43)",
              opacity: submitting ? 0.65 : 1,
            }}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={submitting || !text.trim()}
            onClick={() => void onSubmit(text)}
            style={{
              flex: 1,
              border: "none",
              borderRadius: "12px",
              padding: "12px",
              fontSize: "calc(var(--bubble-font-size, 16px) - 2px)",
              cursor: submitting ? "wait" : "pointer",
              fontFamily: "inherit",
              lineHeight: 1,
              background: "#3b6ed6",
              color: "#fff",
              opacity: submitting || !text.trim() ? 0.65 : 1,
            }}
          >
            {submitting ? t("loading") : t("submitModerationPetition")}
          </button>
        </div>
      </div>
    </div>
  );
}
