import { Env } from "../types";
import { consumeDurableRateLimit, hashRateLimitIdentifier } from "../lib/durable-rate-limit";
import { assertAllowedPreviewUrl, PreviewError } from "../lib/preview-policy";

const PREVIEW_FETCH_TIMEOUT_MS = 5000;
const PREVIEW_MAX_RESPONSE_BYTES = 512 * 1024;
const PREVIEW_MAX_REDIRECTS = 5;
const PREVIEW_RATE_LIMIT_WINDOW_MS = 60_000;
const PREVIEW_RATE_LIMIT_MAX = 60;

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
  const rawUrl = new URL(request.url).searchParams.get("url");
  if (!rawUrl) {
    return Response.json({ error: "url parameter required" }, { status: 400 });
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
