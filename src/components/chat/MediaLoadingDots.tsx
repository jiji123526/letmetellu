"use client";

export function MediaLoadingDots({
  minHeight = "calc(var(--bubble-font-size) * 1.38)",
}: {
  minHeight?: string;
}) {
  return (
    <div
      className="media-loading-dots"
      role="status"
      aria-label="Loading media"
      style={{ minHeight }}
    >
      <span />
      <span />
      <span />
    </div>
  );
}
