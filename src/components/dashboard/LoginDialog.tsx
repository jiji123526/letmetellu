"use client";

import { CloseIcon } from "@/components/ui/CloseIcon";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useLocale } from "@/hooks/useLocale";

interface LoginDialogProps {
  onClose: () => void;
  initialError?: string;
  initialTab?: "login" | "signup";
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

export function LoginDialog({ onClose, initialError = "", initialTab = "login" }: LoginDialogProps) {
  const { locale, t } = useLocale();
  const [tab, setTab] = useState<"login" | "signup" | "forgot">(initialTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const switchTab = (next: "login" | "signup") => {
    if (submitting) return;
    setTab(next);
    setError("");
    setVerificationSent(false);
  };

  const handleForgotPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!email) return setError(t("allFieldsRequired"));
    if (!isValidEmail(email)) return setError(t("invalidEmail"));
    setSubmitting(true);
    try {
      const response = await fetch("/api/email-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request-password-reset", email, locale }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(
          data.error === "too_many_requests"
            ? t("emailVerificationRateLimited")
            : data.error === "email_delivery_failed"
              ? t("emailDeliveryFailed")
              : t("passwordResetError")
        );
        return;
      }
      setVerificationSent(true);
    } catch {
      setError(t("passwordResetError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignup = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!email || !password || !confirmPassword) return setError(t("allFieldsRequired"));
    if (!isValidEmail(email)) return setError(t("invalidEmail"));
    if (password.length < 8 || password.length > 128) return setError(t("passwordLengthRequirement"));
    if (password !== confirmPassword) return setError(t("passwordMismatch"));
    setSubmitting(true);
    try {
      const response = await fetch("/api/email-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "signup", email, password, locale }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(
          data.error === "too_many_requests"
            ? t("emailVerificationRateLimited")
            : data.error === "email_delivery_failed"
              ? t("emailDeliveryFailed")
              : data.error === "weak_password"
                ? t("passwordLengthRequirement")
                : t("signupError")
        );
        return;
      }
      setVerificationSent(true);
    } catch {
      setError(t("signupError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!email || !password) return setError(t("allFieldsRequired"));
    if (!isValidEmail(email)) return setError(t("invalidEmail"));
    setSubmitting(true);
    try {
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError(t("loginError"));
        setSubmitting(false);
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setError(t("loginError"));
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setSubmitting(true);
    try {
      sessionStorage.setItem("letmetellu_auth_flow", tab);
    } catch {}
    try {
      await signIn(tab === "login" ? "google-login" : "google-signup", {
        callbackUrl: tab === "login" ? "/dashboard" : "/dashboard?onboarding=true",
      });
    } catch {
      setError(t(tab === "login" ? "oauthLoginError" : "signupError"));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.35)", backdropFilter: "blur(5px)" }} onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <div className="w-full max-w-[390px] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-[24px] px-6 pt-5 pb-6" style={{ background: "var(--bg)", color: "var(--gray-text)", boxShadow: "0 24px 70px rgba(0,0,0,.22)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="m-0 text-[21px] font-semibold">{t(tab === "login" ? "loginTab" : tab === "signup" ? "signupTab" : "forgotPassword")}</h2>
            <p className="mt-1 mb-0 text-[12px]" style={{ color: "var(--meta)" }}>{t("appDesc")}</p>
          </div>
          <button type="button" disabled={submitting} className="w-8 h-8 rounded-full border-none cursor-pointer flex items-center justify-center" style={{ background: "var(--card)", color: "var(--meta)" }} onClick={onClose} aria-label={t("close")}><CloseIcon /></button>
        </div>

        {tab !== "forgot" && <div className="relative flex rounded-[9px] p-[2px] mb-5" style={{ background: "var(--gray-bubble)" }}>
          <span className="pointer-events-none absolute top-[2px] bottom-[2px] left-[2px] rounded-[7px]" style={{ width: "calc(50% - 2px)", background: "var(--input-bg)", boxShadow: "0 1px 3px rgba(0,0,0,.12)", transform: tab === "signup" ? "translateX(100%)" : "translateX(0)", transition: "transform 240ms cubic-bezier(.22,.8,.36,1)" }} />
          {(["login", "signup"] as const).map((option) => (
            <button key={option} type="button" className="relative z-10 flex-1 border-none bg-transparent py-2 text-[13px] cursor-pointer" style={{ color: tab === option ? "var(--gray-text)" : "var(--secondary-text)", transition: "color 180ms ease" }} onClick={() => switchTab(option)}>
              {t(option === "login" ? "loginTab" : "signupTab")}
            </button>
          ))}
        </div>}

        {tab !== "forgot" && <button type="button" disabled={submitting} className="w-full flex items-center justify-center gap-2.5 rounded-[12px] py-3 text-[14px] font-semibold cursor-pointer" style={{ border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--gray-text)" }} onClick={() => void handleGoogleLogin()}>
          <GoogleIcon /> {t(tab === "login" ? "googleLogin" : "googleSignup")}
        </button>}
        {tab === "login" ? (
          <>
          <div className="flex items-center gap-3 my-4"><span className="h-px flex-1" style={{ background: "var(--hairline)" }} /><span className="text-[11px]" style={{ color: "var(--meta)" }}>{t("or")}</span><span className="h-px flex-1" style={{ background: "var(--hairline)" }} /></div>
          <form onSubmit={handleLogin}>
          <label className="block text-[12px] font-medium mb-1.5">{t("email")}</label>
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-[11px] outline-none text-[15px] mb-4" style={{ border: "1px solid var(--input-border)", padding: "11px 12px", boxSizing: "border-box", background: "var(--input-bg)", color: "var(--gray-text)" }} />
          <label className="block text-[12px] font-medium mb-1.5">{t("password")}</label>
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-[11px] outline-none text-[15px]" style={{ border: "1px solid var(--input-border)", padding: "11px 12px", boxSizing: "border-box", background: "var(--input-bg)", color: "var(--gray-text)" }} />
          <div className="flex justify-end pt-2">
            <button type="button" disabled={submitting} className="border-none bg-transparent p-0 text-[12px] cursor-pointer" style={{ color: "var(--tint)" }} onClick={() => { setTab("forgot"); setError(""); setVerificationSent(false); setPassword(""); }}>
              {t("forgotPassword")}
            </button>
          </div>
          <div className="min-h-[30px] pt-2 text-[12px] text-center" style={{ color: "#ff3b30" }}>{error}</div>
          <button disabled={submitting} type="submit" className="w-full border-none rounded-[12px] py-3 text-white text-[15px] font-semibold" style={{ background: submitting ? "#9ec9f5" : "#007aff", cursor: submitting ? "wait" : "pointer" }}>
            {submitting ? t("loading") : t("loginTab")}
          </button>
          </form>
          </>
        ) : tab === "signup" ? (
          <>
            {verificationSent ? (
              <div className="mt-4 rounded-[16px] px-5 py-6 text-center" style={{ background: "var(--card)" }}>
                <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center text-[22px]" style={{ background: "#eaf3ff", color: "#007aff" }}>✓</div>
                <h3 className="m-0 text-[17px] font-semibold">{t("verificationEmailSentTitle")}</h3>
                <p className="mt-2 mb-0 text-[13px] leading-[1.5]" style={{ color: "var(--secondary-text)" }}>{t("verificationEmailSentDesc")}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 my-4"><span className="h-px flex-1" style={{ background: "var(--hairline)" }} /><span className="text-[11px]" style={{ color: "var(--meta)" }}>{t("or")}</span><span className="h-px flex-1" style={{ background: "var(--hairline)" }} /></div>
                <form onSubmit={handleSignup}>
                  <label className="block text-[12px] font-medium mb-1.5">{t("email")}</label>
                  <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-[11px] outline-none text-[15px] mb-4" style={{ border: "1px solid var(--input-border)", padding: "11px 12px", boxSizing: "border-box", background: "var(--input-bg)", color: "var(--gray-text)" }} />
                  <label className="block text-[12px] font-medium mb-1.5">{t("password")}</label>
                  <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-[11px] outline-none text-[15px] mb-1.5" style={{ border: "1px solid var(--input-border)", padding: "11px 12px", boxSizing: "border-box", background: "var(--input-bg)", color: "var(--gray-text)" }} />
                  <p className="mt-0 mb-4 text-[11px]" style={{ color: "var(--meta)" }}>{t("passwordLengthRequirement")}</p>
                  <label className="block text-[12px] font-medium mb-1.5">{t("confirmPassword")}</label>
                  <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="w-full rounded-[11px] outline-none text-[15px]" style={{ border: "1px solid var(--input-border)", padding: "11px 12px", boxSizing: "border-box", background: "var(--input-bg)", color: "var(--gray-text)" }} />
                  <div className="min-h-[30px] pt-2 text-[12px] text-center" style={{ color: "#ff3b30" }}>{error}</div>
                  <button disabled={submitting} type="submit" className="w-full border-none rounded-[12px] py-3 text-white text-[15px] font-semibold" style={{ background: submitting ? "#9ec9f5" : "#007aff", cursor: submitting ? "wait" : "pointer" }}>
                    {submitting ? t("loading") : t("sendVerificationEmail")}
                  </button>
                </form>
              </>
            )}
          </>
        ) : (
          verificationSent ? (
            <div className="mt-4 rounded-[16px] px-5 py-6 text-center" style={{ background: "var(--card)" }}>
              <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center text-[22px]" style={{ background: "#eaf3ff", color: "#007aff" }}>✓</div>
              <h3 className="m-0 text-[17px] font-semibold">{t("passwordResetEmailSentTitle")}</h3>
              <p className="mt-2 mb-5 text-[13px] leading-[1.5]" style={{ color: "var(--secondary-text)" }}>{t("passwordResetEmailSentDesc")}</p>
              <button type="button" className="border-none bg-transparent text-[13px] cursor-pointer" style={{ color: "var(--tint)" }} onClick={() => switchTab("login")}>{t("backToLogin")}</button>
            </div>
          ) : (
            <form className="mt-4" onSubmit={handleForgotPassword}>
              <p className="mt-0 mb-5 text-[13px] leading-[1.5]" style={{ color: "var(--secondary-text)" }}>{t("forgotPasswordDesc")}</p>
              <label className="block text-[12px] font-medium mb-1.5">{t("email")}</label>
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-[11px] outline-none text-[15px]" style={{ border: "1px solid var(--input-border)", padding: "11px 12px", boxSizing: "border-box", background: "var(--input-bg)", color: "var(--gray-text)" }} />
              <div className="min-h-[30px] pt-2 text-[12px] text-center" style={{ color: "#ff3b30" }}>{error}</div>
              <button disabled={submitting} type="submit" className="w-full border-none rounded-[12px] py-3 text-white text-[15px] font-semibold" style={{ background: submitting ? "#9ec9f5" : "#007aff", cursor: submitting ? "wait" : "pointer" }}>
                {submitting ? t("loading") : t("sendPasswordResetEmail")}
              </button>
              <button type="button" disabled={submitting} className="w-full border-none bg-transparent pt-4 text-[13px] cursor-pointer" style={{ color: "var(--tint)" }} onClick={() => switchTab("login")}>{t("backToLogin")}</button>
            </form>
          )
        )}
        {tab === "signup" && !verificationSent && (
          <p className="mt-4 mb-0 text-center text-[11px] leading-[1.5]" style={{ color: "var(--meta)" }}>
            {locale === "ko" ? "가입을 진행하면 " : "By signing up, you agree to the "}
            <Link href="/terms" target="_blank" className="underline" style={{ color: "var(--meta)" }}>
              {locale === "ko" ? "서비스 이용약관" : "Terms of Service"}
            </Link>
            {locale === "ko" ? "에 동의하고 " : " and acknowledge the "}
            <Link href="/privacy" target="_blank" className="underline" style={{ color: "var(--meta)" }}>
              {locale === "ko" ? "개인정보처리방침" : "Privacy Policy"}
            </Link>
            {locale === "ko" ? "을 확인한 것으로 봅니다." : "."}
          </p>
        )}
      </div>
    </div>
  );
}
