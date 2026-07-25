"use client";

export function MediaLoadingDots({
  minHeight = "calc(var(--bubble-font-size) * 1.38)",
  imageBubble = false,
}: {
  minHeight?: string;
  imageBubble?: boolean;
}) {
  return (
    <div
      className="media-loading-dots"
      role="status"
      aria-label="Loading media"
      style={{
        minHeight: imageBubble ? `calc(${minHeight} + 16px)` : minHeight,
        padding: imageBubble ? "0 10px" : undefined,
      }}
    >
      <span />
      <span />
      <span />
    </div>
  );
}
