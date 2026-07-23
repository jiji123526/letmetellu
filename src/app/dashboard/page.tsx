"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <main className="min-h-dvh flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div style={{ color: "var(--meta)" }}>로딩 중...</div>
      </main>
    );
  }

  if (!session) return null;

  return (
    <main className="min-h-dvh" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      <header className="flex items-center justify-between p-4" style={{ borderBottom: "0.5px solid var(--hairline)" }}>
        <h1 className="text-lg font-semibold">내 채널</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: "var(--meta)" }}>{session.user?.email}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm cursor-pointer"
            style={{ background: "none", border: "1px solid var(--input-border)", borderRadius: "8px", padding: "6px 12px", color: "var(--gray-text)", fontFamily: "inherit", lineHeight: 1 }}
          >
            로그아웃
          </button>
        </div>
      </header>

      <div className="p-4">
        <p style={{ color: "var(--meta)", textAlign: "center", padding: "40px 0" }}>
          아직 채널이 없습니다. 새 채널을 만들어보세요.
        </p>
        {/* TODO: list channels, create channel button */}
      </div>
    </main>
  );
}
