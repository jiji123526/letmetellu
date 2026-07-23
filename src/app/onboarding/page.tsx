"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

const GUIDE_ITEMS = [
  { title: "관리자 설정 열기", detail: "우측 상단 ⋮ 메뉴를 누르면 \"관리자 설정\"이 나타납니다. 여기서 모든 채널 설정을 관리할 수 있습니다." },
  { title: "채널 프로필", detail: "채널 이름과 프로필 사진을 변경합니다. 사진은 정사각형으로 잘라서 업로드됩니다. 변경 즉시 모든 접속자에게 반영됩니다." },
  { title: "채널 규칙", detail: "방문자에게 보여지는 이용 규칙을 설정합니다. 여러 섹션으로 나눌 수 있으며, 규칙이 있으면 채팅 상단에 ℹ️ 버튼이 나타납니다." },
  { title: "전체 공지", detail: "채팅 상단에 배너 형태로 표시됩니다. 제목과 내용을 작성할 수 있으며, 사용자가 닫을 수 있습니다. 새 공지를 등록하면 닫았던 배너가 다시 나타납니다." },
  { title: "채널 색상", detail: "채팅 말풍선의 기본 색상을 변경합니다. 7가지 프리셋 중 선택하거나 직접 색상을 지정할 수 있습니다." },
  { title: "채널 비밀번호", detail: "비밀번호를 설정하면 채널 입장 시 비밀번호를 입력해야 합니다. 비워두면 누구나 입장 가능합니다." },
  { title: "금지어", detail: "특정 단어가 포함된 메시지를 자동으로 차단합니다. 영구 또는 기간 한정(1일/7일/30일)으로 설정 가능합니다." },
  { title: "사용자 차단", detail: "메시지를 꾹 눌러 즉시 차단할 수 있습니다. UID + 기기 지문으로 식별됩니다. 차단된 사용자는 1회 이의 제기(DM)를 보낼 수 있습니다." },
  { title: "채팅 얼리기", detail: "채팅을 일시적으로 중단합니다. 관리자만 메시지를 보낼 수 있고, 일반 사용자는 DM만 가능합니다." },
  { title: "라이브", detail: "임시 채팅 세션을 시작합니다. 종료 시 모든 라이브 메시지가 자동 삭제됩니다. 이모지 리액션 바가 활성화됩니다." },
];

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [openItems, setOpenItems] = useState<Set<number>>(new Set());
  const [createdSlug, setCreatedSlug] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  const handleSlugInput = (val: string) => {
    setSlug(val.toLowerCase().replace(/[^a-z0-9-]/g, ""));
  };

  const handleCreate = async () => {
    setError("");
    if (!slug) { setError("채널 주소를 입력해주세요"); return; }
    if (slug.length < 3) { setError("채널 주소는 3자 이상이어야 합니다"); return; }
    if (!/^[a-z0-9-]{3,30}$/.test(slug)) { setError("영문 소문자, 숫자, 하이픈만 가능합니다"); return; }
    if (!name.trim()) { setError("채널 이름을 입력해주세요"); return; }

    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-channel", channel_id: slug, payload: { name: name.trim() } }),
    });
    const data = await res.json();
    if (data.error) {
      if (data.error === "channel already exists") setError("이미 사용 중인 채널 주소입니다");
      else setError(data.error);
      return;
    }
    setCreatedSlug(slug);
    setStep(2);
  };

  const toggleItem = (i: number) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  if (status === "loading") return null;

  return (
    <main style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", background: "#f7f7f7", minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div style={{ background: "#fff", borderRadius: "20px", padding: "36px 28px", maxWidth: "360px", width: "100%", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
        {/* Icon */}
        <div style={{ fontSize: "48px", textAlign: "center", marginBottom: "16px" }}>🎉</div>

        {/* Title */}
        <div style={{ fontSize: "22px", fontWeight: 500, textAlign: "center", marginBottom: "6px" }}>
          {step === 1 ? "채널 만들기" : "시작하기"}
        </div>
        {step === 1 && (
          <div style={{ fontSize: "13px", color: "#999", textAlign: "center", marginBottom: "28px", lineHeight: 1.6 }}>
            나만의 익명 채팅방을 만들어 보세요!<br />채널 주소는 나중에 변경할 수 없습니다.
          </div>
        )}

        {/* Step indicator */}
        <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "24px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: step === 1 ? "#3b8df0" : "#e0e0e0" }} />
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: step === 2 ? "#3b8df0" : "#e0e0e0" }} />
        </div>

        {/* Step 1: Create */}
        {step === 1 && (
          <>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "6px" }}>채널 주소</label>
              <input
                type="text"
                value={slug}
                onChange={(e) => handleSlugInput(e.target.value)}
                placeholder="my-channel"
                autoComplete="off"
                style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e0e0e0", borderRadius: "12px", fontSize: "14px", fontFamily: "inherit", outline: "none", background: "#f8f8f8", boxSizing: "border-box" }}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "#3b8df0"; }}
                onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "#e0e0e0"; }}
              />
              <div style={{ fontSize: "11px", color: "#bbb", marginTop: "4px" }}>영문 소문자, 숫자, 하이픈 (3-30자)</div>
              {slug && <div style={{ fontSize: "12px", color: "#3b8df0", marginTop: "6px", fontWeight: 500 }}>letmetellu.vercel.app/ch/{slug}</div>}
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "12px", color: "#888", fontWeight: 600, marginBottom: "6px" }}>채널 이름</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="표시될 이름"
                maxLength={30}
                style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e0e0e0", borderRadius: "12px", fontSize: "14px", fontFamily: "inherit", outline: "none", background: "#f8f8f8", boxSizing: "border-box" }}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "#3b8df0"; }}
                onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "#e0e0e0"; }}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={!slug || !name.trim()}
              style={{ width: "100%", padding: "13px", border: "none", borderRadius: "14px", fontSize: "15px", fontWeight: 500, color: "#fff", background: (!slug || !name.trim()) ? "#ccc" : "#3b8df0", cursor: (!slug || !name.trim()) ? "not-allowed" : "pointer", fontFamily: "inherit", marginTop: "8px", lineHeight: 1 }}
            >
              채널 만들기
            </button>
          </>
        )}

        {/* Step 2: Guide */}
        {step === 2 && (
          <>
            <div style={{ textAlign: "left", marginBottom: "20px" }}>
              <div style={{ fontSize: "18px", fontWeight: 500, color: "#222", marginBottom: "6px" }}>✅ 채널이 생성되었습니다!</div>
              <div style={{ fontSize: "13px", color: "#888", marginBottom: "14px" }}>채널 관리자 기능을 확인하세요.</div>
              <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 0 }}>
                {GUIDE_ITEMS.map((item, i) => (
                  <li key={i} style={{ borderBottom: i < GUIDE_ITEMS.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                    <button
                      onClick={() => toggleItem(i)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "12px 4px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", color: "#444", textAlign: "left" }}
                    >
                      <strong style={{ fontWeight: 500 }}>{item.title}</strong>
                      <span style={{ color: openItems.has(i) ? "#3b8df0" : "#ccc", fontSize: "14px", transition: "transform 0.2s", transform: openItems.has(i) ? "rotate(90deg)" : "none" }}>›</span>
                    </button>
                    {openItems.has(i) && (
                      <div style={{ padding: "0 4px 12px", fontSize: "12px", color: "#888", lineHeight: 1.6 }}>
                        {item.detail}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: "16px", padding: "10px 12px", background: "#f0f7ff", borderRadius: "10px", fontSize: "12px", color: "#3b8df0", lineHeight: 1.5 }}>
                💡 채널 주소를 공유하면 누구나 익명으로 참여할 수 있습니다. 로그인 없이 바로 채팅이 가능합니다.
              </div>
            </div>
            <button
              onClick={() => router.push(`/ch/${createdSlug}`)}
              style={{ width: "100%", padding: "13px", border: "none", borderRadius: "14px", fontSize: "15px", fontWeight: 500, color: "#fff", background: "#3b8df0", cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}
            >
              내 채널로 이동 →
            </button>
          </>
        )}

        {/* Error */}
        <div style={{ color: "#e74c3c", fontSize: "12px", textAlign: "center", marginTop: "12px", minHeight: "18px" }}>{error}</div>
      </div>
    </main>
  );
}
