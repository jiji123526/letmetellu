"use client";

import { useMemo, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import type { GlobalNotice } from "@/lib/api-global-notice";
import { GlobalNoticeSurface } from "@/components/dashboard/GlobalNoticeDialog";

interface GlobalNoticeEditorDialogProps {
  notice: GlobalNotice | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (draft: { title: string; body: string }) => Promise<void>;
  onClear: () => Promise<void>;
}

export function GlobalNoticeEditorDialog({
  notice,
  saving,
  error,
  onClose,
  onSave,
  onClear,
}: GlobalNoticeEditorDialogProps) {
  const { t } = useLocale();
  const [title, setTitle] = useState(notice?.title || "");
  const [body, setBody] = useState(notice?.body || "");
  const [step, setStep] = useState<"current" | "compose" | "preview">(notice ? "current" : "compose");
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const canPreview = trimmedTitle.length > 0;
  const previewNotice = useMemo<GlobalNotice>(() => ({
    title: trimmedTitle || t("globalNoticeTitlePlaceholder"),
    body: trimmedBody,
    version: notice?.version || "preview",
  }), [notice?.version, t, trimmedBody, trimmedTitle]);

  return (
    <div
      className="fixed inset-0 z-[660] flex items-center justify-center px-5"
      style={{ background: "rgba(0,0,0,.4)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      role="presentation"
    >
      {step === "current" && notice ? (
        <GlobalNoticeSurface
          notice={notice}
          titleId="global-notice-current-title"
          footer={(
            <div
              className="flex items-center gap-2 px-5 py-4"
              style={{ borderTop: "0.5px solid var(--hairline, rgba(60,60,67,.22))" }}
            >
              <button
                type="button"
                disabled={saving}
                className="flex-1 rounded-[12px] border-none py-3 text-[14px] font-semibold cursor-pointer"
                style={{ background: "#fff1f2", color: "#dc2626", fontFamily: "inherit" }}
                onClick={() => void onClear()}
              >
                {t("globalNoticeClear")}
              </button>
              <button
                type="button"
                disabled={saving}
                className="flex-1 rounded-[12px] border-none py-3 text-[14px] font-semibold cursor-pointer"
                style={{ background: "var(--card, #f2f2f7)", color: "var(--gray-text)", fontFamily: "inherit" }}
                onClick={onClose}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={saving}
                className="flex-1 rounded-[12px] border-none py-3 text-[14px] font-semibold text-white cursor-pointer"
                style={{ background: saving ? "#9ec9f5" : "#007aff", fontFamily: "inherit" }}
                onClick={() => setStep("compose")}
              >
                {t("globalNoticeEdit")}
              </button>
            </div>
          )}
        />
      ) : step === "preview" ? (
        <GlobalNoticeSurface
          notice={previewNotice}
          titleId="global-notice-preview-title"
          footer={(
            <div
              className="flex items-center gap-2 px-5 py-4"
              style={{ borderTop: "0.5px solid var(--hairline, rgba(60,60,67,.22))" }}
            >
              <button
                type="button"
                disabled={saving}
                className="flex-1 rounded-[12px] border-none py-3 text-[14px] font-semibold cursor-pointer"
                style={{ background: "var(--card, #f2f2f7)", color: "var(--gray-text)", fontFamily: "inherit" }}
                onClick={() => setStep("compose")}
              >
                {t("globalNoticeBackToEdit")}
              </button>
              <button
                type="button"
                disabled={saving}
                className="flex-1 rounded-[12px] border-none py-3 text-[14px] font-semibold text-white cursor-pointer"
                style={{ background: saving ? "#9ec9f5" : "#007aff", fontFamily: "inherit" }}
                onClick={() => void onSave({ title: trimmedTitle, body: trimmedBody })}
              >
                {saving ? t("loading") : t("globalNoticePublish")}
              </button>
            </div>
          )}
        />
      ) : (
        <section
          className="w-full max-w-[390px] overflow-hidden"
          style={{
            background: "var(--bg, #fff)",
            borderRadius: "22px",
            boxShadow: "0 18px 50px rgba(0,0,0,.22)",
            color: "var(--gray-text, #111)",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="global-notice-editor-title"
        >
          <div className="px-6 pt-6 pb-5">
            <div className="mb-4">
              <div
                className="mb-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[.08em]"
                style={{ background: "var(--card, #f2f2f7)", color: "var(--tint, #007aff)" }}
              >
                {t("globalNoticeBadge")}
              </div>
              <h2 id="global-notice-editor-title" className="m-0 text-[20px] font-bold tracking-[-.02em]">
                {t("globalNoticeEditorTitle")}
              </h2>
              <p className="mt-2 mb-0 text-[13px] leading-[1.55]" style={{ color: "var(--meta, #8e8e93)" }}>
                {t("globalNoticeEditorDescription")}
              </p>
            </div>

            <label className="mb-2 block text-[12px] font-semibold" style={{ color: "var(--meta)" }}>
              {t("globalNoticeTitleLabel")}
            </label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("globalNoticeTitlePlaceholder")}
              className="mb-4 w-full rounded-[12px] border px-3 py-3 text-[14px] outline-none"
              style={{
                borderColor: "var(--input-border)",
                background: "var(--input-bg)",
                color: "var(--gray-text)",
                boxSizing: "border-box",
              }}
            />

            <label className="mb-2 block text-[12px] font-semibold" style={{ color: "var(--meta)" }}>
              {t("globalNoticeBodyLabel")}
            </label>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t("globalNoticeBodyPlaceholder")}
              className="min-h-[132px] w-full rounded-[12px] border px-3 py-3 text-[14px] outline-none"
              style={{
                borderColor: "var(--input-border)",
                background: "var(--input-bg)",
                color: "var(--gray-text)",
                boxSizing: "border-box",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />

            {error && (
              <p className="mt-3 mb-0 text-[12px]" style={{ color: "#dc2626" }}>
                {error}
              </p>
            )}

            {!notice && !error && (
              <p className="mt-3 mb-0 text-[12px]" style={{ color: "var(--meta)" }}>
                {t("globalNoticeEmpty")}
              </p>
            )}
          </div>

          <div
            className="flex items-center gap-2 px-5 py-4"
            style={{ borderTop: "0.5px solid var(--hairline, rgba(60,60,67,.22))" }}
          >
            {notice && (
              <button
                type="button"
                disabled={saving}
                className="flex-1 rounded-[12px] border-none py-3 text-[14px] font-semibold cursor-pointer"
                style={{ background: "#fff1f2", color: "#dc2626", fontFamily: "inherit" }}
                onClick={() => void onClear()}
              >
                {t("globalNoticeClear")}
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              className="flex-1 rounded-[12px] border-none py-3 text-[14px] font-semibold cursor-pointer"
              style={{ background: "var(--card, #f2f2f7)", color: "var(--gray-text)", fontFamily: "inherit" }}
              onClick={onClose}
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              disabled={saving || !canPreview}
              className="flex-1 rounded-[12px] border-none py-3 text-[14px] font-semibold text-white cursor-pointer"
              style={{ background: saving || !canPreview ? "#9ec9f5" : "#007aff", fontFamily: "inherit" }}
              onClick={() => setStep("preview")}
            >
              {t("globalNoticePreview")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
