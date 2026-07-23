"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("모든 필드를 입력해주세요"); return; }

    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError("이메일 또는 비밀번호가 틀렸습니다");
    } else {
      window.location.href = "/dashboard";
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("모든 필드를 입력해주세요"); return; }
    if (password.length < 8 || !/\d/.test(password)) { setError("비밀번호는 8자 이상, 숫자를 포함해야 합니다"); return; }

    // Create account on Worker
    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "";
    const signupRes = await fetch(`${workerUrl}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "signup", email, password }),
    });
    const signupData = await signupRes.json() as { ok?: boolean; error?: string };
    if (!signupData.ok) {
      if (signupData.error === "user_exists") setError("이미 가입된 이메일입니다");
      else if (signupData.error === "weak_password") setError("비밀번호는 8자 이상, 숫자를 포함해야 합니다");
      else setError("가입에 실패했습니다");
      return;
    }

    // Auto sign in after signup
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError("가입 후 로그인에 실패했습니다");
    } else {
      window.location.href = "/onboarding";
    }
  };

  const handleGoogleAuth = (redirectTo: string) => {
    signIn("google", { callbackUrl: redirectTo });
  };

  const switchTab = (t: "login" | "signup") => {
    setTab(t);
    setError("");
    setSuccess("");
  };

  return (
    <main style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", background: "#f7f7f7", minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div style={{ background: "#fff", borderRadius: "20px", padding: "36px 28px", maxWidth: "360px", width: "100%", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
        {/* Title */}
        <div style={{ fontSize: "24px", fontWeight: 500, textAlign: "center", marginBottom: "6px" }}>💬 letsplay</div>
        <div style={{ fontSize: "13px", color: "#999", textAlign: "center", marginBottom: "28px" }}>나만의 익명 채팅방 만들기</div>

        {/* Tabs */}
        <div style={{ display: "flex", marginBottom: "24px", borderRadius: "10px", overflow: "hidden", border: "1px solid #eee" }}>
          <button
            onClick={() => switchTab("login")}
            style={{ flex: 1, padding: "10px", textAlign: "center", fontSize: "14px", fontWeight: 600, cursor: "pointer", background: tab === "login" ? "#fff" : "#f8f8f8", color: tab === "login" ? "#222" : "#999", border: "none", fontFamily: "inherit" }}
          >
            로그인
          </button>
          <button
            onClick={() => switchTab("signup")}
            style={{ flex: 1, padding: "10px", textAlign: "center", fontSize: "14px", fontWeight: 600, cursor: "pointer", background: tab === "signup" ? "#fff" : "#f8f8f8", color: tab === "signup" ? "#222" : "#999", border: "none", fontFamily: "inherit" }}
          >
            가입하기
          </button>
        </div>

        {/* Login tab */}
        {tab === "login" && (
          <>
            <button
              onClick={() => handleGoogleAuth("/dashboard")}
              style={{ width: "100%", padding: "13px", border: "1.5px solid #e0e0e0", borderRadius: "14px", fontSize: "15px", fontWeight: 600, color: "#333", background: "#fff", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", lineHeight: 1 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Google로 로그인
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "16px 0" }}>
              <div style={{ flex: 1, height: "1px", background: "#e8e8e8" }} />
              <span style={{ fontSize: "12px", color: "#999" }}>또는</span>
              <div style={{ flex: 1, height: "1px", background: "#e8e8e8" }} />
            </div>
            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "6px" }}>이메일</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e0e0e0", borderRadius: "12px", fontSize: "14px", fontFamily: "inherit", outline: "none", background: "#f8f8f8", boxSizing: "border-box" }} onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "#3b8df0"; }} onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "#e0e0e0"; }} />
              </div>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "6px" }}>비밀번호</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e0e0e0", borderRadius: "12px", fontSize: "14px", fontFamily: "inherit", outline: "none", background: "#f8f8f8", boxSizing: "border-box" }} onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "#3b8df0"; }} onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "#e0e0e0"; }} />
              </div>
              <button type="submit" style={{ width: "100%", padding: "13px", border: "none", borderRadius: "14px", fontSize: "15px", fontWeight: 500, color: "#fff", background: "#3b8df0", cursor: "pointer", fontFamily: "inherit", marginTop: "8px", lineHeight: 1 }}>로그인</button>
            </form>
          </>
        )}

        {/* Signup tab */}
        {tab === "signup" && (
          <>
            <button
              onClick={() => handleGoogleAuth("/onboarding")}
              style={{ width: "100%", padding: "13px", border: "1.5px solid #e0e0e0", borderRadius: "14px", fontSize: "15px", fontWeight: 600, color: "#333", background: "#fff", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", lineHeight: 1 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Google로 가입하기
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "16px 0" }}>
              <div style={{ flex: 1, height: "1px", background: "#e8e8e8" }} />
              <span style={{ fontSize: "12px", color: "#999" }}>또는</span>
              <div style={{ flex: 1, height: "1px", background: "#e8e8e8" }} />
            </div>
            <form onSubmit={handleSignup}>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "6px" }}>이메일</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e0e0e0", borderRadius: "12px", fontSize: "14px", fontFamily: "inherit", outline: "none", background: "#f8f8f8", boxSizing: "border-box" }} onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "#3b8df0"; }} onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "#e0e0e0"; }} />
              </div>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "6px" }}>비밀번호</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8자 이상, 숫자 포함" style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e0e0e0", borderRadius: "12px", fontSize: "14px", fontFamily: "inherit", outline: "none", background: "#f8f8f8", boxSizing: "border-box" }} onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "#3b8df0"; }} onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "#e0e0e0"; }} />
                <div style={{ fontSize: "11px", color: "#bbb", marginTop: "4px" }}>8자 이상, 숫자 포함</div>
              </div>
              <button type="submit" style={{ width: "100%", padding: "13px", border: "none", borderRadius: "14px", fontSize: "15px", fontWeight: 500, color: "#fff", background: "#3b8df0", cursor: "pointer", fontFamily: "inherit", marginTop: "8px", lineHeight: 1 }}>가입하기</button>
            </form>
          </>
        )}

        {/* Error / Success */}
        {error && <div style={{ color: "#e74c3c", fontSize: "12px", textAlign: "center", marginTop: "10px" }}>{error}</div>}
        {success && <div style={{ color: "#34c759", fontSize: "12px", textAlign: "center", marginTop: "10px" }}>{success}</div>}
      </div>
    </main>
  );
}
