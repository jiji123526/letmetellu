"use client";

export function MediaLoadingDots({ minHeight = "58px" }: { minHeight?: string }) {
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
