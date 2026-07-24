"use client";

interface NoticeSection {
  title: string;
  items: string[];
}

interface NoticePanelProps {
  notice: NoticeSection[];
  onClose: () => void;
}

export function NoticePanel({ notice, onClose }: NoticePanelProps) {
  if (!notice || notice.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center animate-[ctxFade_0.2s_ease]"
      style={{
        background: "rgba(0,0,0,.4)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        padding: "24px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[320px] max-h-[80vh] rounded-[16px] overflow-hidden flex flex-col"
        style={{ background: "var(--bg)", color: "var(--gray-text)", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between flex-none" style={{ padding: "16px 18px", borderBottom: "0.5px solid var(--hairline)" }}>
          <h3 className="m-0 font-medium" style={{ fontSize: "var(--bubble-font-size, 16px)" }}>채널 안내</h3>
          <button
            className="bg-transparent border-none cursor-pointer"
            style={{ fontSize: "18px", color: "var(--meta)", padding: "4px 8px" }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto" style={{ padding: "16px 18px", fontSize: "var(--bubble-font-size, 15px)" }}>
          {notice.map((section, i) => (
            <div key={i} style={{ marginBottom: i < notice.length - 1 ? "16px" : 0 }}>
              <h4 className="m-0" style={{ fontSize: "var(--bubble-font-size, 15px)", fontWeight: 400, color: "var(--bubble-sent)", marginBottom: "8px" }}>
                {section.title}
              </h4>
              <ul style={{ margin: 0, padding: "0 0 0 18px", listStyle: "disc" }}>
                {section.items.map((item, j) => (
                  <li key={j} style={{ marginBottom: "6px", lineHeight: 1.4, color: "var(--gray-text)", fontSize: "var(--bubble-font-size, 15px)" }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
