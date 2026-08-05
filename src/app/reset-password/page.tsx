"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Providers } from "@/components/Providers";
import { useLocale } from "@/hooks/useLocale";

function ResetPasswordContent() {
  const { t } = useLocale();
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8 || password.length > 128) return setError(t("passwordLengthRequirement"));
    if (password !== confirmPassword) return setError(t("passwordMismatch"));
    setSubmitting(true);
    try {
      const response = await fetch("/api/email-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-password", token, password }),
      });
      const data = await response.json() as { ok?: boolean };
      if (!response.ok || !data.ok) return setError(t("resetPasswordInvalid"));
      setComplete(true);
    } catch {
      setError(t("passwordResetError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-dvh flex items-center justify-center p-4" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      <div className="w-full max-w-[390px] rounded-[24px] px-6 py-7" style={{ background: "var(--card)", boxShadow: "0 20px 60px rgba(0,0,0,.12)" }}>
        {complete ? (
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center text-[22px]" style={{ background: "#eaf3ff", color: "#007aff" }}>✓</div>
            <h1 className="m-0 text-[21px] font-semibold">{t("resetPasswordSuccess")}</h1>
            <a href="/dashboard?login=true" className="mt-6 block rounded-[12px] py-3 text-white text-[15px] font-semibold no-underline" style={{ background: "#007aff" }}>{t("continueToLogin")}</a>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1 className="m-0 text-[21px] font-semibold">{t("resetPasswordTitle")}</h1>
            <p className="mt-2 mb-5 text-[13px] leading-[1.5]" style={{ color: "var(--secondary-text)" }}>{t("resetPasswordDesc")}</p>
            <label className="block text-[12px] font-medium mb-1.5">{t("password")}</label>
            <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-[11px] outline-none text-[15px] mb-4" style={{ border: "1px solid var(--input-border)", padding: "11px 12px", boxSizing: "border-box", background: "var(--input-bg)", color: "var(--gray-text)" }} />
            <label className="block text-[12px] font-medium mb-1.5">{t("confirmPassword")}</label>
            <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="w-full rounded-[11px] outline-none text-[15px]" style={{ border: "1px solid var(--input-border)", padding: "11px 12px", boxSizing: "border-box", background: "var(--input-bg)", color: "var(--gray-text)" }} />
            <div className="min-h-[34px] pt-2 text-[12px] text-center" style={{ color: "#ff3b30" }}>{error}</div>
            <button disabled={submitting || !token} type="submit" className="w-full border-none rounded-[12px] py-3 text-white text-[15px] font-semibold" style={{ background: submitting || !token ? "#9ec9f5" : "#007aff", cursor: submitting ? "wait" : "pointer" }}>
              {submitting ? t("loading") : t("resetPasswordButton")}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Providers>
      <Suspense>
        <ResetPasswordContent />
      </Suspense>
    </Providers>
  );
}
