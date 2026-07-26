"use client";

import { useState } from "react";
import { useLocale } from "@/hooks/useLocale";

export function EmailVerification({ token }: { token: string }) {
  const { t } = useLocale();
  const [status, setStatus] = useState<"ready" | "submitting" | "success" | "invalid">(
    token ? "ready" : "invalid"
  );

  const verify = async () => {
    if (!token || status === "submitting") return;
    setStatus("submitting");
    try {
      const response = await fetch("/api/email-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify-email", token }),
      });
      const data = await response.json() as { ok?: boolean };
      if (response.ok && data.ok) {
        window.history.replaceState(null, "", "/verify-email");
        setStatus("success");
      } else {
        setStatus("invalid");
      }
    } catch {
      setStatus("invalid");
    }
  };

  const successful = status === "success";
  const invalid = status === "invalid";

  return (
    <main className="min-h-dvh flex items-center justify-center p-5" style={{ background: "#f2f2f7", color: "#111" }}>
      <section className="w-full max-w-[390px] rounded-[24px] px-6 py-7 text-center" style={{ background: "#fff", boxShadow: "0 18px 55px rgba(0,0,0,.12)" }}>
        <div className="w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center text-[24px] font-semibold" style={{ background: successful ? "#eaf8ef" : invalid ? "#fff0ef" : "#eaf3ff", color: successful ? "#2a9d4e" : invalid ? "#ff3b30" : "#007aff" }}>
          {successful ? "✓" : invalid ? "!" : "@"}
        </div>
        <h1 className="m-0 text-[22px] font-bold">
          {t(successful ? "verifyEmailSuccessTitle" : invalid ? "verifyEmailInvalidTitle" : "verifyEmailTitle")}
        </h1>
        <p className="mt-2 mb-6 text-[14px] leading-[1.55]" style={{ color: "#6d6d72" }}>
          {t(successful ? "verifyEmailSuccessDesc" : invalid ? "verifyEmailInvalidDesc" : "verifyEmailDesc")}
        </p>
        {successful ? (
          <button type="button" className="w-full border-none rounded-[12px] py-3 text-white text-[15px] font-semibold cursor-pointer" style={{ background: "#007aff" }} onClick={() => { window.location.href = "/dashboard?login=true"; }}>
            {t("continueToLogin")}
          </button>
        ) : !invalid ? (
          <button type="button" disabled={status === "submitting"} className="w-full border-none rounded-[12px] py-3 text-white text-[15px] font-semibold" style={{ background: status === "submitting" ? "#9ec9f5" : "#007aff", cursor: status === "submitting" ? "wait" : "pointer" }} onClick={() => void verify()}>
            {status === "submitting" ? t("loading") : t("verifyEmailButton")}
          </button>
        ) : (
          <button type="button" className="w-full border-none rounded-[12px] py-3 text-white text-[15px] font-semibold cursor-pointer" style={{ background: "#007aff" }} onClick={() => { window.location.href = "/dashboard?login=true"; }}>
            {t("continueToLogin")}
          </button>
        )}
      </section>
    </main>
  );
}
