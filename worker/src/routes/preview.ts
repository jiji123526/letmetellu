import { Env } from "../types";
import { consumeDurableRateLimit, hashRateLimitIdentifier } from "../lib/durable-rate-limit";
import { assertAllowedPreviewUrl, PreviewError } from "../lib/preview-policy";
import { parsePreviewMetadata } from "../lib/preview-metadata";
import {
  getPreviewFailureCacheTtl,
  PREVIEW_EMPTY_CACHE_TTL_SECONDS,
  PREVIEW_SUCCESS_CACHE_TTL_SECONDS,
} from "../lib/preview-cache-policy";

const PREVIEW_FETCH_TIMEOUT_MS = 5000;
const PREVIEW_MAX_RESPONSE_BYTES = 512 * 1024;
const PREVIEW_MAX_REDIRECTS = 5;
const PREVIEW_RATE_LIMIT_WINDOW_MS = 60_000;
const PREVIEW_RATE_LIMIT_MAX = 60;
const PREVIEW_CACHE_VERSION = "v2";

function getPreviewRequestIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Client-IP")
    || "unknown";
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
    throw new PreviewError("preview upstream fetch failed", 502);
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
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let totalBytes = 0;
  let html = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const remainingBytes = PREVIEW_MAX_RESPONSE_BYTES - totalBytes;
    if (value.byteLength > remainingBytes) {
      html += decoder.decode(value.subarray(0, remainingBytes), { stream: true });
      await reader.cancel();
      break;
    }

    totalBytes += value.byteLength;
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
  try {
    return await response.json() as { title?: string; author_name?: string };
  } catch {
    throw new PreviewError("invalid youtube preview response", 502);
  }
}

async function cachePreview(cacheKey: Request, response: Response): Promise<void> {
  try {
    await caches.default.put(cacheKey, response.clone());
  } catch (error) {
    console.warn("failed to cache preview", error);
  }
}

function createCacheablePreviewResponse(
  body: Record<string, unknown>,
  status: number,
  ttlSeconds: number,
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": `public, max-age=${ttlSeconds}` },
  });
}

async function createPreviewFailureResponse(
  cacheKey: Request,
  message: string,
  status: number,
): Promise<Response> {
  const ttlSeconds = getPreviewFailureCacheTtl(status);
  if (!ttlSeconds) {
    return Response.json({ error: message }, { status });
  }
  const response = createCacheablePreviewResponse({ error: message }, status, ttlSeconds);
  await cachePreview(cacheKey, response);
  return response;
}

export async function handlePreview(request: Request, env: Env): Promise<Response> {
  const rawUrl = new URL(request.url).searchParams.get("url");
  if (!rawUrl) {
    return Response.json({ error: "url parameter required" }, { status: 400 });
  }
  let previewUrl: URL;
  try {
    previewUrl = assertAllowedPreviewUrl(rawUrl);
  } catch (error) {
    if (error instanceof PreviewError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "invalid url" }, { status: 400 });
  }

  const cacheKey = new Request(new URL(`/__preview_cache/${PREVIEW_CACHE_VERSION}?url=${encodeURIComponent(rawUrl)}`, request.url).toString(), {
    method: "GET",
  });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    return cached;
  }

  const previewSubject = await hashRateLimitIdentifier("preview-ip", getPreviewRequestIp(request), env);
  const previewRateLimit = await consumeDurableRateLimit({
    env,
    scope: "preview-fetch",
    subjectKey: previewSubject,
    limit: PREVIEW_RATE_LIMIT_MAX,
    windowMs: PREVIEW_RATE_LIMIT_WINDOW_MS,
  });
  if (!previewRateLimit.ok) {
    return Response.json({ error: "preview_rate_limited" }, { status: 429 });
  }

  try {
    // YouTube: use noembed for title, return thumbnail directly.
    const ytMatch = rawUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      const videoId = ytMatch[1];
      const oembedData = await fetchYouTubeOEmbed(videoId);
      const previewResponse = Response.json({
        title: oembedData.title || "",
        description: oembedData.author_name || "",
        image: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        video: "",
        siteName: "YouTube",
        url: rawUrl,
      }, { headers: { "Cache-Control": `public, max-age=${PREVIEW_SUCCESS_CACHE_TTL_SECONDS}` } });
      await cachePreview(cacheKey, previewResponse);
      return previewResponse;
    }

    // Twitter/X: use fxtwitter for better OG tags.
    let fetchUrl = previewUrl;
    if (previewUrl.toString().match(/https?:\/\/(twitter\.com|x\.com)\//)) {
      fetchUrl = assertAllowedPreviewUrl(previewUrl.toString().replace(/twitter\.com|x\.com/, "fxtwitter.com"));
    }

    const response = await fetchPreviewDocument(fetchUrl);
    if (!response.ok) {
      return createPreviewFailureResponse(cacheKey, "fetch failed", 502);
    }

    const contentType = response.headers.get("Content-Type") || "";
    if (!/^text\/html\b/i.test(contentType) && !/^application\/xhtml\+xml\b/i.test(contentType)) {
      return createPreviewFailureResponse(cacheKey, "unsupported preview content type", 415);
    }

    const html = await readResponseTextWithLimit(response);

    const metadata = parsePreviewMetadata(html, response.url || fetchUrl.toString());

    if (previewUrl.toString().match(/https?:\/\/(twitter\.com|x\.com)\//)) {
      metadata.video = "";
    }

    const hasUsefulMetadata = Boolean(metadata.title || metadata.image);
    const previewResponse = Response.json({ ...metadata, url: rawUrl }, {
      headers: {
        "Cache-Control": `public, max-age=${hasUsefulMetadata
          ? PREVIEW_SUCCESS_CACHE_TTL_SECONDS
          : PREVIEW_EMPTY_CACHE_TTL_SECONDS}`,
      },
    });
    await cachePreview(cacheKey, previewResponse);
    return previewResponse;
  } catch (error) {
    if (error instanceof PreviewError) {
      return createPreviewFailureResponse(cacheKey, error.message, error.status);
    }
    console.error("unexpected preview failure", error);
    return Response.json({ error: "failed to fetch preview" }, { status: 500 });
  }
}
