import { Env } from "../types";

const PREVIEW_FETCH_TIMEOUT_MS = 5000;
const PREVIEW_MAX_RESPONSE_BYTES = 512 * 1024;
const PREVIEW_MAX_REDIRECTS = 5;
const PREVIEW_RATE_LIMIT_WINDOW_MS = 60_000;
const PREVIEW_RATE_LIMIT_MAX = 60;

const previewRateLimit = new Map<string, number[]>();
let lastPreviewRateLimitCleanup = 0;

class PreviewError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
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

function isBlockedHostname(hostname: string): boolean {
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

function assertAllowedPreviewUrl(rawUrl: string): URL {
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
  if (isBlockedHostname(parsed.hostname)) {
    throw new PreviewError("blocked preview host", 400);
  }

  return parsed;
}

function getPreviewRequestIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Client-IP")
    || "unknown";
}

function enforcePreviewRateLimit(request: Request): boolean {
  const now = Date.now();
  if (now - lastPreviewRateLimitCleanup > PREVIEW_RATE_LIMIT_WINDOW_MS) {
    lastPreviewRateLimitCleanup = now;
    for (const [ip, timestamps] of previewRateLimit.entries()) {
      const recent = timestamps.filter((timestamp) => now - timestamp < PREVIEW_RATE_LIMIT_WINDOW_MS);
      if (recent.length === 0) previewRateLimit.delete(ip);
      else previewRateLimit.set(ip, recent);
    }
  }

  const ip = getPreviewRequestIp(request);
  const timestamps = previewRateLimit.get(ip) || [];
  const recent = timestamps.filter((timestamp) => now - timestamp < PREVIEW_RATE_LIMIT_WINDOW_MS);
  if (recent.length >= PREVIEW_RATE_LIMIT_MAX) return false;
  recent.push(now);
  previewRateLimit.set(ip, recent);
  return true;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREVIEW_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new PreviewError("preview fetch timeout", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPreviewDocument(initialUrl: URL): Promise<Response> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= PREVIEW_MAX_REDIRECTS; redirectCount++) {
    const response = await fetchWithTimeout(currentUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "manual",
    });

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get("Location");
    if (!location) {
      throw new PreviewError("redirect missing location", 502);
    }
    if (redirectCount === PREVIEW_MAX_REDIRECTS) {
      throw new PreviewError("too many redirects", 400);
    }

    currentUrl = assertAllowedPreviewUrl(new URL(location, currentUrl).toString());
  }

  throw new PreviewError("too many redirects", 400);
}

async function readResponseTextWithLimit(response: Response): Promise<string> {
  const contentLengthHeader = response.headers.get("Content-Length");
  const declaredLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : NaN;
  if (Number.isFinite(declaredLength) && declaredLength > PREVIEW_MAX_RESPONSE_BYTES) {
    throw new PreviewError("preview response too large", 413);
  }

  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let totalBytes = 0;
  let html = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > PREVIEW_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new PreviewError("preview response too large", 413);
    }
    html += decoder.decode(value, { stream: true });
  }

  html += decoder.decode();
  return html;
}

async function fetchYouTubeOEmbed(videoId: string): Promise<{ title?: string; author_name?: string }> {
  const response = await fetchWithTimeout(
    `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`,
    { redirect: "error" },
  );
  if (!response.ok) {
    throw new PreviewError("failed to fetch youtube preview", 502);
  }
  return response.json() as Promise<{ title?: string; author_name?: string }>;
}

export async function handlePreview(request: Request, env: Env): Promise<Response> {
  void env;

  const rawUrl = new URL(request.url).searchParams.get("url");
  if (!rawUrl) {
    return Response.json({ error: "url parameter required" }, { status: 400 });
  }
  if (!enforcePreviewRateLimit(request)) {
    return Response.json({ error: "preview_rate_limited" }, { status: 429 });
  }

  try {
    const previewUrl = assertAllowedPreviewUrl(rawUrl);

    // YouTube: use noembed for title, return thumbnail directly.
    const ytMatch = rawUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      const videoId = ytMatch[1];
      const oembedData = await fetchYouTubeOEmbed(videoId);
      return Response.json({
        title: oembedData.title || "",
        description: oembedData.author_name || "",
        image: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        video: "",
        siteName: "YouTube",
        url: rawUrl,
      }, { headers: { "Cache-Control": "public, max-age=3600" } });
    }

    // Twitter/X: use fxtwitter for better OG tags.
    let fetchUrl = previewUrl;
    if (previewUrl.toString().match(/https?:\/\/(twitter\.com|x\.com)\//)) {
      fetchUrl = assertAllowedPreviewUrl(previewUrl.toString().replace(/twitter\.com|x\.com/, "fxtwitter.com"));
    }

    const response = await fetchPreviewDocument(fetchUrl);
    if (!response.ok) {
      return Response.json({ error: "fetch failed" }, { status: 502 });
    }

    const contentType = response.headers.get("Content-Type") || "";
    if (!/^text\/html\b/i.test(contentType) && !/^application\/xhtml\+xml\b/i.test(contentType)) {
      return Response.json({ error: "unsupported preview content type" }, { status: 415 });
    }

    const html = await readResponseTextWithLimit(response);

    const getMetaContent = (property: string): string => {
      const match = html.match(new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"))
        || html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`, "i"))
        || html.match(new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"));
      return match ? match[1] : "";
    };

    const title = getMetaContent("og:title") || getMetaContent("twitter:title") || "";
    const description = getMetaContent("og:description") || getMetaContent("twitter:description") || "";
    const image = getMetaContent("og:image") || getMetaContent("twitter:image") || "";
    let video = getMetaContent("og:video") || getMetaContent("og:video:url") || getMetaContent("twitter:player:stream") || "";
    const siteName = getMetaContent("og:site_name") || "";

    if (previewUrl.toString().match(/https?:\/\/(twitter\.com|x\.com)\//)) {
      video = "";
    }

    return Response.json({ title, description, image, video, siteName, url: rawUrl }, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    if (error instanceof PreviewError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "failed to fetch preview" }, { status: 500 });
  }
}
