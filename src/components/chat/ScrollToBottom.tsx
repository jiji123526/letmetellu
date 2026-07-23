"use client";

interface ScrollToBottomProps {
  visible: boolean;
  unreadCount?: number;
  onClick: () => void;
}

export function ScrollToBottom({ visible, unreadCount, onClick }: ScrollToBottomProps) {
  if (!visible) return null;

  return (
    <button
      className="absolute bottom-[70px] left-1/2 -translate-x-1/2 z-10 w-9 h-9 rounded-full border-none cursor-pointer flex items-center justify-center"
      style={{
        background: "var(--composer-bg)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        boxShadow: "0 2px 12px rgba(0,0,0,.15)",
      }}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
      {unreadCount && unreadCount > 0 ? (
        <span
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-medium text-white px-1"
          style={{ background: "var(--bubble-sent, #3b8df0)" }}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </button>
  );
}
