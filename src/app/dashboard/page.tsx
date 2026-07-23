"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Channel {
  id: string;
  name: string;
  profile_image: string | null;
  bubble_color: string;
  created_at: string;
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  // Sync user and fetch channels
  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/user")
        .then((res) => res.json())
        .then((data) => {
          if (data.channels) setChannels(data.channels);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [status]);

  const handleCreate = async () => {
    const slug = newSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const name = newName.trim();
    if (!slug || !name) return;

    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "";
    const res = await fetch(`${workerUrl}/api/user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: session?.user?.id,
        email: session?.user?.email,
        name: session?.user?.name,
        image: session?.user?.image,
      }),
    });

    // Create channel via admin endpoint
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-channel", channel_id: slug, payload: { name } }),
    });

    setCreating(false);
    setNewSlug("");
    setNewName("");
    // Refresh channels
    const data = await res.json();
    if (data.channels) setChannels(data.channels);
    else router.refresh();
  };

  if (status === "loading" || loading) {
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
        {/* Channel list */}
        {channels.length > 0 ? (
          <div className="flex flex-col gap-3">
            {channels.map((ch) => (
              <a
                key={ch.id}
                href={`/ch/${ch.id}`}
                className="flex items-center gap-3 p-3 rounded-[12px] no-underline"
                style={{ border: "1px solid var(--hairline)", color: "var(--gray-text)" }}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm" style={{ background: ch.bubble_color || "#3b8df0" }}>
                  {ch.name[0]}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{ch.name}</div>
                  <div className="text-xs" style={{ color: "var(--meta)" }}>/ch/{ch.id}</div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p style={{ color: "var(--meta)", textAlign: "center", padding: "40px 0" }}>
            아직 채널이 없습니다
          </p>
        )}

        {/* Create channel */}
        {creating ? (
          <div className="mt-4 p-4 rounded-[12px]" style={{ border: "1px solid var(--hairline)" }}>
            <input
              type="text"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="채널 주소 (영문, 숫자, -)"
              style={{ width: "100%", border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--gray-text)", borderRadius: "10px", padding: "10px 12px", fontSize: "14px", fontFamily: "inherit", marginBottom: "8px", outline: "none", boxSizing: "border-box", lineHeight: 1 }}
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="채널 이름"
              style={{ width: "100%", border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--gray-text)", borderRadius: "10px", padding: "10px 12px", fontSize: "14px", fontFamily: "inherit", marginBottom: "12px", outline: "none", boxSizing: "border-box", lineHeight: 1 }}
            />
            <div className="flex gap-2">
              <button onClick={() => setCreating(false)} style={{ flex: 1, border: "none", borderRadius: "10px", padding: "10px", fontSize: "14px", cursor: "pointer", fontFamily: "inherit", background: "#f4f4f4", color: "#666", lineHeight: 1 }}>취소</button>
              <button onClick={handleCreate} style={{ flex: 1, border: "none", borderRadius: "10px", padding: "10px", fontSize: "14px", cursor: "pointer", fontFamily: "inherit", background: "var(--bubble-sent, #3b8df0)", color: "#fff", lineHeight: 1 }}>만들기</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full mt-4 cursor-pointer"
            style={{ border: "1px dashed var(--input-border)", borderRadius: "12px", padding: "14px", fontSize: "14px", fontFamily: "inherit", background: "none", color: "var(--meta)", lineHeight: 1 }}
          >
            + 새 채널 만들기
          </button>
        )}
      </div>
    </main>
  );
}
