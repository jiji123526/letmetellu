"use client";

import { signIn } from "next-auth/react";
import { useRef, useState, type FormEvent } from "react";
import { useLocale } from "@/hooks/useLocale";

interface LoginDialogProps {
  onClose: () => void;
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

export function LoginDialog({ onClose }: LoginDialogProps) {
  const { t } = useLocale();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const switchTab = (next: "login" | "signup") => {
    if (submitting) return;
    setTab(next);
    setError("");
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!email || !password) return setError(t("allFieldsRequired"));
    if (!isValidEmail(email)) return setError(t("invalidEmail"));
    setSubmitting(true);
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError(t("loginError"));
      setSubmitting(false);
    } else {
      window.location.href = "/dashboard";
    }
  };

  const handleSignup = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setError("");
    if (!email || !password) return setError(t("allFieldsRequired"));
    if (!isValidEmail(email)) return setError(t("invalidEmail"));
    if (password.length < 8 || !/\d/.test(password)) return setError(t("weakPassword"));

    submittingRef.current = true;
    setSubmitting(true);
    let redirecting = false;
    try {
      const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "";
      const response = await fetch(`${workerUrl}/api/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "signup", email, password }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!data.ok) {
        setError(data.error === "user_exists" ? t("userExists") : data.error === "weak_password" ? t("weakPassword") : t("signupError"));
        return;
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError(t("signupError"));
        return;
      }
      redirecting = true;
      window.location.href = "/onboarding";
    } catch {
      setError(t("signupError"));
    } finally {
      if (!redirecting) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.35)", backdropFilter: "blur(5px)" }} onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <div className="w-full max-w-[390px] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-[24px] px-6 pt-5 pb-6" style={{ background: "#fff", boxShadow: "0 24px 70px rgba(0,0,0,.22)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="m-0 text-[21px] font-semibold">{t(tab === "login" ? "loginTab" : "signupTab")}</h2>
            <p className="mt-1 mb-0 text-[12px]" style={{ color: "#8e8e93" }}>{t("appDesc")}</p>
          </div>
          <button type="button" disabled={submitting} className="w-8 h-8 rounded-full border-none cursor-pointer text-[20px]" style={{ background: "#f2f2f7", color: "#8e8e93" }} onClick={onClose} aria-label={t("close")}>×</button>
        </div>

        <div className="relative flex rounded-[9px] p-[2px] mb-5" style={{ background: "#e9e9ee" }}>
          <span className="pointer-events-none absolute top-[2px] bottom-[2px] left-[2px] rounded-[7px]" style={{ width: "calc(50% - 2px)", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.12)", transform: tab === "signup" ? "translateX(100%)" : "translateX(0)", transition: "transform 240ms cubic-bezier(.22,.8,.36,1)" }} />
          {(["login", "signup"] as const).map((option) => (
            <button key={option} type="button" className="relative z-10 flex-1 border-none bg-transparent py-2 text-[13px] cursor-pointer" style={{ color: tab === option ? "#111" : "#6d6d72", transition: "color 180ms ease" }} onClick={() => switchTab(option)}>
              {t(option === "login" ? "loginTab" : "signupTab")}
            </button>
          ))}
        </div>

        <button type="button" disabled={submitting} className="w-full flex items-center justify-center gap-2.5 rounded-[12px] py-3 text-[14px] font-semibold cursor-pointer" style={{ border: "1px solid #d1d1d6", background: "#fff", color: "#333" }} onClick={() => void signIn("google", { callbackUrl: tab === "login" ? "/dashboard" : "/onboarding" })}>
          <GoogleIcon /> {t(tab === "login" ? "googleLogin" : "googleSignup")}
        </button>
        <div className="flex items-center gap-3 my-4"><span className="h-px flex-1 bg-[#e5e5ea]" /><span className="text-[11px]" style={{ color: "#8e8e93" }}>{t("or")}</span><span className="h-px flex-1 bg-[#e5e5ea]" /></div>

        <form onSubmit={tab === "login" ? handleLogin : handleSignup}>
          <label className="block text-[12px] font-medium mb-1.5">{t("email")}</label>
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-[11px] outline-none text-[15px] mb-4" style={{ border: "1px solid #d1d1d6", padding: "11px 12px", boxSizing: "border-box", background: "#f7f7f9" }} />
          <label className="block text-[12px] font-medium mb-1.5">{t("password")}</label>
          <input type="password" autoComplete={tab === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={tab === "signup" ? t("passwordHint") : undefined} className="w-full rounded-[11px] outline-none text-[15px]" style={{ border: "1px solid #d1d1d6", padding: "11px 12px", boxSizing: "border-box", background: "#f7f7f9" }} />
          {tab === "signup" && <div className="mt-1.5 text-[11px]" style={{ color: "#8e8e93" }}>{t("passwordHint")}</div>}
          <div className="min-h-[30px] pt-2 text-[12px] text-center" style={{ color: "#ff3b30" }}>{error}</div>
          <button disabled={submitting} type="submit" className="w-full border-none rounded-[12px] py-3 text-white text-[15px] font-semibold" style={{ background: submitting ? "#9ec9f5" : "#007aff", cursor: submitting ? "wait" : "pointer" }}>
            {submitting ? t("loading") : t(tab === "login" ? "loginTab" : "signupTab")}
          </button>
        </form>
      </div>
    </div>
  );
}
