"use client";

import { useEffect, useRef, useState } from "react";

// URL patterns
const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/;
const INSTAGRAM_REGEX = /https?:\/\/(www\.)?instagram\.com\/(p|reel)\/[\w-]+/;
const URL_REGEX = /https?:\/\/[^\s<]+/g;
const EMBED_PREVIEW_ROOT_MARGIN = "720px";

interface PreviewData {
  title: string;
  description: string;
  image: string;
  video: string;
  siteName: string;
  url: string;
}

const PREVIEW_CACHE_NAME = "letmetellu-link-previews-v2";
const LEGACY_PREVIEW_STORAGE_KEY = "letmetellu_link_previews_v1";
const PREVIEW_CACHE_LIMIT = 200;
const PREVIEW_CACHED_AT_HEADER = "X-Letmetellu-Preview-Cached-At";
const PREVIEW_FRESH_TTL_MS = 24 * 60 * 60 * 1000;
const PREVIEW_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const previewCache = new Map<string, PreviewData | null>();
const previewCacheMetadata = new Map<string, { cachedAt: number }>();
const previewRequests = new Map<string, Promise<PreviewData | null>>();
let persistentPreviewCachePromise: Promise<Cache | null> | null = null;
let legacyPreviewStorageCleaned = false;

function isPreviewData(value: unknown): value is PreviewData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PreviewData>;
  return typeof candidate.title === "string"
    && typeof candidate.description === "string"
    && typeof candidate.image === "string"
    && typeof candidate.video === "string"
    && typeof candidate.siteName === "string"
    && typeof candidate.url === "string";
}

function compactPreviewData(data: PreviewData): PreviewData {
  return {
    title: data.title.slice(0, 500),
    description: data.description.slice(0, 1000),
    image: data.image.slice(0, 4096),
    video: data.video.slice(0, 4096),
    siteName: data.siteName.slice(0, 200),
    url: data.url.slice(0, 4096),
  };
}

function getPreviewCacheRequest(url: string): Request {
  return new Request(
    new URL(`/api/preview?url=${encodeURIComponent(url)}`, window.location.origin),
    { method: "GET" },
  );
}

function openPersistentPreviewCache(): Promise<Cache | null> {
  if (persistentPreviewCachePromise) return persistentPreviewCachePromise;
  if (typeof window === "undefined") return Promise.resolve(null);

  if (!legacyPreviewStorageCleaned) {
    legacyPreviewStorageCleaned = true;
    try {
      localStorage.removeItem(LEGACY_PREVIEW_STORAGE_KEY);
    } catch {
      // Legacy cleanup is optional.
    }
  }

  if (!("caches" in window)) return Promise.resolve(null);
  persistentPreviewCachePromise = window.caches.open(PREVIEW_CACHE_NAME).catch(() => null);
  return persistentPreviewCachePromise;
}

async function trimPersistentPreviewCache(cache: Cache) {
  const keys = await cache.keys();
  const excessCount = keys.length - PREVIEW_CACHE_LIMIT;
  if (excessCount <= 0) return;
  await Promise.all(keys.slice(0, excessCount).map((request) => cache.delete(request)));
}

async function persistPreview(url: string, data: PreviewData, cachedAt: number) {
  if (url.length > 2048) return;
  const cache = await openPersistentPreviewCache();
  if (!cache) return;

  try {
    const request = getPreviewCacheRequest(url);
    const response = new Response(JSON.stringify(compactPreviewData(data)), {
      headers: {
        "Content-Type": "application/json",
        [PREVIEW_CACHED_AT_HEADER]: String(cachedAt),
      },
    });
    await cache.delete(request);
    await cache.put(request, response);
    await trimPersistentPreviewCache(cache);
  } catch {
    // Cache API persistence is optional and must not block rendering.
  }
}

async function readCachedPreview(url: string): Promise<{ data: PreviewData; isStale: boolean } | null> {
  const data = previewCache.get(url);
  if (data) {
    const cachedAt = previewCacheMetadata.get(url)?.cachedAt || Date.now();
    return { data, isStale: Date.now() - cachedAt > PREVIEW_FRESH_TTL_MS };
  }
  if (previewCache.has(url)) return null;

  const cache = await openPersistentPreviewCache();
  if (!cache) return null;

  try {
    const request = getPreviewCacheRequest(url);
    const response = await cache.match(request);
    if (!response) return null;

    const cachedAt = Number(response.headers.get(PREVIEW_CACHED_AT_HEADER));
    const now = Date.now();
    if (!Number.isFinite(cachedAt) || cachedAt <= 0 || now - cachedAt > PREVIEW_MAX_STALE_MS) {
      await cache.delete(request);
      return null;
    }

    const cachedData = await response.json() as unknown;
    if (!isPreviewData(cachedData)) {
      await cache.delete(request);
      return null;
    }

    const normalized = compactPreviewData(cachedData);
    previewCache.set(url, normalized);
    previewCacheMetadata.set(url, { cachedAt });
    return { data: normalized, isStale: now - cachedAt > PREVIEW_FRESH_TTL_MS };
  } catch {
    return null;
  }
}

function requestPreview(url: string, forceRefresh = false): Promise<PreviewData | null> {
  const pending = previewRequests.get(url);
  if (pending) return pending;

  const request = fetch(`/api/preview?url=${encodeURIComponent(url)}`)
    .then((response) => response.ok ? response.json() as Promise<PreviewData | null> : null)
    .then((result) => {
      const normalized = result && (result.title || result.image) ? result : null;
      if (normalized) {
        const now = Date.now();
        previewCache.set(url, normalized);
        previewCacheMetadata.set(url, { cachedAt: now });
        void persistPreview(url, normalized, now);
      } else if (!forceRefresh) {
        previewCache.set(url, null);
      }
      return normalized;
    })
    .catch(() => {
      if (!forceRefresh) previewCache.set(url, null);
      return null;
    })
    .finally(() => {
      previewRequests.delete(url);
    });

  previewRequests.set(url, request);
  return request;
}

function useDeferredEmbedVisibility(rootMargin: string) {
  const targetRef = useRef<HTMLAnchorElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const activateForNavigation = () => setIsVisible(true);
    window.addEventListener("chat-history-preload", activateForNavigation);
    return () => window.removeEventListener("chat-history-preload", activateForNavigation);
  }, []);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || isVisible) return;
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setIsVisible(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin });

    observer.observe(target);
    return () => observer.disconnect();
  }, [isVisible, rootMargin]);

  return { targetRef, isVisible };
}

function LinkPreviewCard({
  url,
  isMine,
  staticOnly = false,
  onReady,
}: {
  url: string;
  isMine: boolean;
  staticOnly?: boolean;
  onReady: (url: string) => void;
}) {
  const [data, setData] = useState<PreviewData | null>(previewCache.get(url) || null);
  const [hasResolved, setHasResolved] = useState(previewCache.has(url));
  const { targetRef, isVisible } = useDeferredEmbedVisibility(EMBED_PREVIEW_ROOT_MARGIN);

  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;
    void (async () => {
      const cached = await readCachedPreview(url);
      if (cancelled) return;

      if (cached) {
        setData(cached.data);
        setHasResolved(true);
        if (!cached.isStale) return;
      } else if (previewCache.has(url)) {
        setHasResolved(true);
        return;
      }

      const result = await requestPreview(url, !!cached);
      if (cancelled) return;
      if (result) setData(result);
      else if (!cached) setData(null);
      setHasResolved(true);
    })().catch(() => {
      if (!cancelled) {
        setHasResolved(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isVisible, url]);

  useEffect(() => {
    if (data) onReady(url);
  }, [data, onReady, url]);

  if (!isVisible && !previewCache.has(url)) {
    return (
      <a
        ref={targetRef}
        style={{ position: "relative", width: "100%", height: 0, overflow: "visible" }}
        aria-hidden="true"
        tabIndex={-1}
      />
    );
  }
  if (!hasResolved) {
    return <span data-history-layout-pending aria-hidden="true" />;
  }
  if (!data) return null;

  const previewVideo = staticOnly ? "" : data.video;
  const hasTextMetadata = !!(data.title || data.description || data.siteName);
  const shouldPreserveFullImage = !!data.image && !previewVideo && !hasTextMetadata;

  return (
    <a
      ref={targetRef}
      className="link-preview-card"
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "block",
        maxWidth: "100%",
        borderRadius: "12px",
        overflow: "hidden",
        width: "min(320px, 100%)",
        background: isMine ? "rgba(0,0,0,.15)" : "rgba(0,0,0,.05)",
        textDecoration: "none",
        color: "inherit",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {previewVideo ? (
        <video
          src={previewVideo}
          poster={data.image || undefined}
          controls
          playsInline
          preload="metadata"
          style={{ width: "100%", display: "block", maxHeight: "200px", objectFit: "cover" }}
          onClick={(e) => e.preventDefault()}
        />
      ) : data.image ? (
        <img
          src={data.image}
          alt=""
          style={{
            width: "100%",
            display: "block",
            maxHeight: shouldPreserveFullImage ? "320px" : "160px",
            objectFit: shouldPreserveFullImage ? "contain" : "cover",
            background: shouldPreserveFullImage ? (isMine ? "rgba(0,0,0,.15)" : "rgba(0,0,0,.05)") : undefined,
          }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : null}
      {hasTextMetadata && (
        <div style={{ padding: "10px 12px" }}>
          {data.siteName && (
            <div style={{ fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--meta)", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.3px" }}>
              {data.siteName}
            </div>
          )}
          {data.title && (
            <div style={{ fontSize: "calc(var(--bubble-font-size) - 2px)", fontWeight: 400, color: isMine ? "#fff" : "var(--gray-text)", lineHeight: 1.3, marginBottom: "2px" }}>
              {data.title}
            </div>
          )}
          {data.description && (
            <div style={{ fontSize: "calc(var(--bubble-font-size) - 4px)", color: isMine ? "rgba(255,255,255,.7)" : "var(--meta)", lineHeight: 1.3 }}>
              {data.description.length > 100 ? data.description.slice(0, 100) + "…" : data.description}
            </div>
          )}
        </div>
      )}
    </a>
  );
}

// Main export: renders embeds for URLs found in message text
export function MessageEmbeds({
  text,
  isMine,
  fillWidth,
  onEmbedReady,
}: {
  text: string;
  isMine: boolean;
  fillWidth: boolean;
  onEmbedReady: (url: string) => void;
}) {
  const urls = text.match(URL_REGEX);
  const unique = [...new Set(urls || [])];

  if (unique.length === 0) return null;

  const renderEmbed = (url: string) => {
    const staticOnly = YOUTUBE_REGEX.test(url) || INSTAGRAM_REGEX.test(url);
    return (
      <LinkPreviewCard
        url={url}
        isMine={isMine}
        staticOnly={staticOnly}
        onReady={onEmbedReady}
      />
    );
  };

  return (
    <div className="message-embeds" style={{
      marginTop: 0,
      paddingBottom: 0,
      overflow: "visible",
      width: fillWidth ? "100%" : "fit-content",
      maxWidth: "100%",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
    }}>
      {unique.map((url) => (
        <div key={url} style={{ width: fillWidth ? "100%" : undefined, maxWidth: "100%" }}>
          {renderEmbed(url)}
        </div>
      ))}
    </div>
  );
}
