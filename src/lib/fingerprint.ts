// Simple browser fingerprint — not cryptographic, but stable per device
export function generateFingerprint(): string {
  if (typeof window === "undefined") return "";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallbackFingerprint();
  ctx.textBaseline = "top";
  ctx.font = "14px Arial";
  ctx.fillText("fp", 2, 2);
  const data = canvas.toDataURL();
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
  }
  const ua = navigator.userAgent + navigator.language + screen.width + screen.height;
  for (let i = 0; i < ua.length; i++) {
    hash = ((hash << 5) - hash + ua.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function fallbackFingerprint(): string {
  const ua = navigator.userAgent + navigator.language + screen.width + screen.height;
  let hash = 0;
  for (let i = 0; i < ua.length; i++) {
    hash = ((hash << 5) - hash + ua.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
