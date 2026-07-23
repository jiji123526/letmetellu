"use client";

import { useState, useEffect } from "react";

export function WelcomePopup({ channelId, bubbleColor }: { channelId: string; bubbleColor?: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const key = `welcomed_${channelId}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, "true");
      setShow(true);
    }
  }, [channelId]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-6"
      style={{
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) setShow(false); }}
    >
      <div
        className="w-full max-w-[320px] rounded-[20px] p-7 text-center"
        style={{ background: "var(--bg)", color: "var(--gray-text)" }}
      >
        <div className="text-[40px] mb-3">💬</div>
        <div className="text-[19px] font-bold mb-4">환영합니다!</div>
        <ul className="text-left flex flex-col gap-[10px] mb-5 list-none p-0">
          {[
            "메시지를 꾹 누르면 답장, 리액션, 신고가 가능합니다",
            "본인이 보낸 메시지는 삭제 및 수정할 수 있습니다",
            "비밀 메시지는 채널 관리자에게만 전달됩니다",
            "우측 상단 메뉴에서 설정, 갤러리, 링크를 확인할 수 있습니다",
          ].map((text, i) => (
            <li key={i} className="text-[13px] leading-[1.5] pl-4 relative" style={{ color: "var(--gray-text)" }}>
              <span className="absolute left-0" style={{ color: "var(--meta)" }}>•</span>
              {text}
            </li>
          ))}
        </ul>
        <button
          className="w-full py-3 border-none rounded-[12px] text-white text-[15px] font-semibold cursor-pointer"
          style={{ background: bubbleColor || "var(--bubble-sent)" }}
          onClick={() => setShow(false)}
        >
          확인
        </button>
      </div>
    </div>
  );
}
