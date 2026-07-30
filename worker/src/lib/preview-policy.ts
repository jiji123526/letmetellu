export class PreviewError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function isIpv4Literal(hostname: string): boolean {
  const parts = hostname.split(".");
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isIpv6Literal(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, "").replace(/\]$/, "");
  return normalized.includes(":");
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isIpv4Literal(hostname)) return false;
  const [a, b] = hostname.split(".").map(Number);
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

export function isBlockedPreviewHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized || normalized === "localhost") return true;
  if (normalized.endsWith(".localhost") || normalized.endsWith(".local") || normalized.endsWith(".internal")) {
    return true;
  }
  if (normalized === "metadata.google.internal" || normalized.endsWith(".home.arpa")) {
    return true;
  }
  if (!normalized.includes(".")) return true;
  if (isPrivateIpv4(normalized)) return true;
  if (isIpv6Literal(normalized)) return true;
  return false;
}

export function assertAllowedPreviewUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new PreviewError("invalid url", 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new PreviewError("unsupported url scheme", 400);
  }
  if (parsed.username || parsed.password) {
    throw new PreviewError("credentials not allowed", 400);
  }
  if (isBlockedPreviewHostname(parsed.hostname)) {
    throw new PreviewError("blocked preview host", 400);
  }

  return parsed;
}
