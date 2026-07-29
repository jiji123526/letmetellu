"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/hooks/useLocale";

const REPORT_REASONS = [
  "spam",
  "harassment",
  "sexual_content",
  "privacy",
  "impersonation",
  "illegal_content",
  "other",
] as const;

type ReportReason = (typeof REPORT_REASONS)[number];

interface ChannelReportDialogProps {
  channelName: string;
  submitting: boolean;
  onSubmit: (reason: ReportReason, details: string) => Promise<void> | void;
  onClose: () => void;
}

export function ChannelReportDialog({
  channelName,
  submitting,
  onSubmit,
  onClose,
}: ChannelReportDialogProps) {
  const { t } = useLocale();
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [details, setDetails] = useState("");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting]);

  const reasonLabels = useMemo<Record<ReportReason, string>>(() => ({
    spam: t("reportReasonSpam"),
    harassment: t("reportReasonHarassment"),
    sexual_content: t("reportReasonSexual"),
    privacy: t("reportReasonPrivacy"),
    impersonation: t("reportReasonImpersonation"),
    illegal_content: t("reportReasonIllegal"),
    other: t("reportReasonOther"),
  }), [t]);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.4)", padding: "20px" }}
      onClick={(event) => {
        if (!submitting && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "360px",
          background: "var(--bg, #fff)",
          borderRadius: "18px",
          padding: "20px",
          boxShadow: "0 18px 50px rgba(0,0,0,.22)",
        }}
      >
        <div style={{ fontSize: "calc(var(--bubble-font-size, 17px) + 1px)", fontWeight: 600, color: "var(--gray-text, #111)", marginBottom: "8px" }}>
          {t("reportChannelTitle")}
        </div>
        <div style={{ fontSize: "calc(var(--bubble-font-size, 16px) - 2px)", color: "var(--meta, #8e8e93)", lineHeight: 1.5, marginBottom: "16px" }}>
          {t("reportChannelDescription").replace("{channel}", channelName)}
        </div>

        <div style={{ fontSize: "calc(var(--bubble-font-size, 16px) - 2px)", fontWeight: 600, color: "var(--gray-text, #111)", marginBottom: "10px" }}>
          {t("reportReasonLabel")}
        </div>
        <div style={{ display: "grid", gap: "8px", marginBottom: "16px" }}>
          {REPORT_REASONS.map((option) => {
            const selected = reason === option;
            return (
              <button
                key={option}
                type="button"
                disabled={submitting}
                onClick={() => setReason(option)}
                style={{
                  borderRadius: "12px",
                  padding: "11px 12px",
                  textAlign: "left",
                  border: selected ? "1px solid var(--bubble-sent, #3b8df0)" : "1px solid var(--hairline, #d1d1d6)",
                  background: selected ? "color-mix(in srgb, var(--bubble-sent, #3b8df0) 12%, transparent)" : "transparent",
                  color: "var(--gray-text, #111)",
                  fontFamily: "inherit",
                  fontSize: "calc(var(--bubble-font-size, 16px) - 2px)",
                  cursor: submitting ? "wait" : "pointer",
                  lineHeight: 1.3,
                }}
              >
                {reasonLabels[option]}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: "calc(var(--bubble-font-size, 16px) - 2px)", fontWeight: 600, color: "var(--gray-text, #111)", marginBottom: "10px" }}>
          {t("reportDetailsLabel")}
        </div>
        <textarea
          value={details}
          maxLength={500}
          disabled={submitting}
          onChange={(event) => setDetails(event.target.value)}
          placeholder={t("reportDetailsPlaceholder")}
          style={{
            width: "100%",
            minHeight: "112px",
            resize: "none",
            borderRadius: "14px",
            border: "1px solid var(--hairline, #d1d1d6)",
            padding: "12px 13px",
            fontFamily: "inherit",
            fontSize: "calc(var(--bubble-font-size, 16px) - 2px)",
            color: "var(--gray-text, #111)",
            background: "var(--card, #f2f2f7)",
            outline: "none",
          }}
        />
        <div style={{ marginTop: "8px", marginBottom: "18px", textAlign: "right", fontSize: "12px", color: "var(--meta, #8e8e93)" }}>
          {details.length}/500
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
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
            disabled={submitting}
            onClick={() => void onSubmit(reason, details)}
            style={{
              flex: 1,
              border: "none",
              borderRadius: "12px",
              padding: "12px",
              fontSize: "calc(var(--bubble-font-size, 16px) - 2px)",
              cursor: submitting ? "wait" : "pointer",
              fontFamily: "inherit",
              lineHeight: 1,
              background: "#d32f2f",
              color: "#fff",
              opacity: submitting ? 0.65 : 1,
            }}
          >
            {submitting ? t("loading") : t("reportSubmit")}
          </button>
        </div>
      </div>
    </div>
  );
}
