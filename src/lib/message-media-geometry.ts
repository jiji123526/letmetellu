const MESSAGE_MEDIA_GEOMETRY_LIMIT = 500;

interface MessageMediaGeometry {
  width: number;
  height: number;
}

const messageMediaGeometry = new Map<string, MessageMediaGeometry>();

function mediaResourceKey(src: string): string {
  try {
    const url = new URL(src, "https://yap.invalid");
    url.searchParams.delete("media_token");
    const origin = url.origin === "https://yap.invalid" ? "" : url.origin;
    return `${origin}${url.pathname}${url.search}`;
  } catch {
    return src;
  }
}

function isValidDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 10_000;
}

export function rememberMessageMediaGeometry(
  src: string,
  width: number,
  height: number,
): void {
  if (!src || !isValidDimension(width) || !isValidDimension(height)) return;
  const key = mediaResourceKey(src);
  messageMediaGeometry.delete(key);
  messageMediaGeometry.set(key, { width, height });
  while (messageMediaGeometry.size > MESSAGE_MEDIA_GEOMETRY_LIMIT) {
    const oldest = messageMediaGeometry.keys().next().value;
    if (typeof oldest !== "string") break;
    messageMediaGeometry.delete(oldest);
  }
}

export function getRememberedMessageMediaGeometry(
  src: string,
): MessageMediaGeometry | null {
  return messageMediaGeometry.get(mediaResourceKey(src)) || null;
}
