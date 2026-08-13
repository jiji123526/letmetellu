import type { ReactNode } from "react";

export function highlightText(text: string, query: string, isActive: boolean): ReactNode {
  if (!query || !text) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, index) =>
    regex.test(part) ? (
      <mark
        key={index}
        style={{
          background: isActive ? "#ff9800" : "#ffd54f",
          color: isActive ? "#fff" : "#000",
          borderRadius: "2px",
          padding: "0 1px",
        }}
      >
        {part}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    )
  );
}
