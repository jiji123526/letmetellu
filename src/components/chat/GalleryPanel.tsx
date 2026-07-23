"use client";

interface GalleryItem {
  id: string;
  image: string;
  created_at: string;
}

interface GalleryPanelProps {
  items: GalleryItem[];
  onViewImage?: (src: string) => void;
  onClose: () => void;
}

function galleryDateLabel(dateStr: string): string {
  if (!dateStr) return "날짜 없음";
  const d = new Date(dateStr);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}/${String(kst.getUTCMonth() + 1).padStart(2, "0")}/${String(kst.getUTCDate()).padStart(2, "0")}`;
}

export function GalleryPanel({ items, onViewImage, onClose }: GalleryPanelProps) {
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
        className="w-full max-w-[360px] max-h-[80vh] rounded-[16px] overflow-hidden flex flex-col"
        style={{ background: "var(--bg)", color: "var(--gray-text)", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between flex-none" style={{ padding: "16px 18px", borderBottom: "0.5px solid var(--hairline)" }}>
          <h3 className="m-0 font-medium" style={{ fontSize: "var(--bubble-font-size, 16px)" }}>
            <svg viewBox="0 0 24 24" width="16" height="16" style={{ verticalAlign: "-2px", display: "inline" }}>
              <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
              <path d="M21 15l-5-5L5 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {" "}갤러리
          </h3>
          <button
            className="bg-transparent border-none cursor-pointer"
            style={{ fontSize: "18px", color: "var(--meta)", padding: "4px 8px" }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Grid */}
        <div className="overflow-y-auto" style={{ padding: "8px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px" }}>
          {items.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", padding: "40px", textAlign: "center", color: "var(--meta)", fontSize: "var(--bubble-font-size, 14px)" }}>
              사진이 없습니다
            </div>
          ) : (
            (() => {
              let lastDate = "";
              return items.map((item) => {
                const dateLabel = galleryDateLabel(item.created_at);
                const showDivider = dateLabel !== lastDate;
                lastDate = dateLabel;
                return (
                  <div key={item.id} style={{ display: "contents" }}>
                    {showDivider && (
                      <div style={{
                        gridColumn: "1 / -1",
                        fontSize: "calc(var(--bubble-font-size, 15px) - 3px)",
                        color: "var(--meta)",
                        padding: "8px 4px 4px",
                        fontWeight: 400,
                      }}>
                        {dateLabel}
                      </div>
                    )}
                    <img
                      src={item.image}
                      className="w-full cursor-pointer"
                      style={{ aspectRatio: "1", objectFit: "cover", borderRadius: "6px", transition: "opacity .15s" }}
                      onClick={() => onViewImage?.(item.image)}
                    />
                  </div>
                );
              });
            })()
          )}
        </div>
      </div>
    </div>
  );
}
