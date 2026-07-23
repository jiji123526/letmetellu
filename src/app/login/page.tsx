"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (result?.error) {
      setError("로그인에 실패했습니다");
    } else {
      window.location.href = "/dashboard";
    }
  };

  return (
    <main className="min-h-dvh flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-[320px] p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "var(--gray-text)" }}>letsplay</h1>
          <p className="text-sm mt-2" style={{ color: "var(--meta)" }}>채널을 만들고 관리하세요</p>
        </div>

        {/* Google OAuth */}
        <button
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="w-full flex items-center justify-center gap-3 mb-4 cursor-pointer"
          style={{ border: "1px solid var(--input-border)", borderRadius: "12px", padding: "12px", background: "var(--input-bg)", color: "var(--gray-text)", fontSize: "15px", fontFamily: "inherit", lineHeight: 1 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Google로 계속하기
        </button>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px" style={{ background: "var(--hairline)" }} />
          <span className="text-xs" style={{ color: "var(--meta)" }}>또는</span>
          <div className="flex-1 h-px" style={{ background: "var(--hairline)" }} />
        </div>

        {/* Email/Password */}
        <form onSubmit={handleEmailLogin}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            required
            style={{ width: "100%", border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--gray-text)", borderRadius: "12px", padding: "12px 14px", fontSize: "15px", fontFamily: "inherit", marginBottom: "8px", outline: "none", lineHeight: 1, boxSizing: "border-box" }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            required
            style={{ width: "100%", border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--gray-text)", borderRadius: "12px", padding: "12px 14px", fontSize: "15px", fontFamily: "inherit", marginBottom: "16px", outline: "none", lineHeight: 1, boxSizing: "border-box" }}
          />
          {error && <p className="text-sm mb-3" style={{ color: "#d32f2f" }}>{error}</p>}
          <button
            type="submit"
            className="w-full cursor-pointer"
            style={{ border: "none", borderRadius: "12px", padding: "12px", fontSize: "15px", fontFamily: "inherit", background: "var(--bubble-sent, #3b8df0)", color: "#fff", fontWeight: 500, lineHeight: 1 }}
          >
            로그인
          </button>
        </form>
      </div>
    </main>
  );
}
