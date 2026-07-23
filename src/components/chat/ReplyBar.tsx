"use client";

interface ReplyBarProps {
  replyingTo: { id: string; text: string; uid: string } | null;
  onClose: () => void;
}

export function ReplyBar({ replyingTo, onClose }: ReplyBarProps) {
  if (!replyingTo) return null;

  return (
    <div
      className="flex items-center justify-between gap-2 px-4 py-2"
      style={{
        background: "var(--composer-bg)",
        borderTop: "0.5px solid var(--hairline)",
        fontSize: "13px",
        color: "var(--meta)",
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" className="flex-shrink-0" style={{ color: "var(--meta)" }}>
        <path d="M9 4l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 11h14a4 4 0 0 1 4 4v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="flex-1 truncate">
        {replyingTo.text || "사진"}
      </span>
      <button
        className="bg-transparent border-none cursor-pointer p-[2px_6px]"
        style={{ color: "var(--meta)", fontSize: "16px" }}
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
