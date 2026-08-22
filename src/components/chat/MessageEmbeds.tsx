"use client";

import { useEffect, useRef, useState } from "react";

// URL patterns
const INSTAGRAM_REGEX = /https?:\/\/(www\.)?instagram\.com\/(p|reel)\/[\w-]+/;
const URL_REGEX = /https?:\/\/[^\s<]+/g;

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
const MAX_CONCURRENT_PREVIEW_REQUESTS = 2;
const MOUNTED_PREVIEW_PREFETCH_LIMIT = 6;
const previewCache = new Map<string, PreviewData | null>();
const previewCacheMetadata = new Map<string, { cachedAt: number }>();
const previewRequests = new Map<string, Promise<PreviewData | null>>();
const previewImageRequests = new Map<string, Promise<void>>();
const previewSubscribers = new Map<string, Set<(data: PreviewData) => void>>();
const readyPreviewImages = new Set<string>();
const previewRequestQueue: Array<{
  url: string;
  forceRefresh: boolean;
  priority: "visible" | "background";
  resolve: (value: PreviewData | null) => void;
}> = [];
let persistentPreviewCachePromise: Promise<Cache | null> | null = null;
let legacyPreviewStorageCleaned = false;
let activePreviewRequests = 0;
let mountedPrefetchPath = "";
let mountedPrefetchBudget = MOUNTED_PREVIEW_PREFETCH_LIMIT;
let mountedPrefetchScheduled = false;
let historyPrefetchListenerInstalled = false;

function rememberReadyPreviewImage(src: string) {
  readyPreviewImages.delete(src);
  readyPreviewImages.add(src);
  while (readyPreviewImages.size > PREVIEW_CACHE_LIMIT) {
    const oldest = readyPreviewImages.values().next().value;
    if (typeof oldest !== "string") break;
    readyPreviewImages.delete(oldest);
  }
}

function notifyPreviewSubscribers(url: string, data: PreviewData) {
  previewSubscribers.get(url)?.forEach((subscriber) => subscriber(data));
}

function subscribeToPreview(url: string, subscriber: (data: PreviewData) => void) {
  const subscribers = previewSubscribers.get(url) || new Set<(data: PreviewData) => void>();
  subscribers.add(subscriber);
  previewSubscribers.set(url, subscribers);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) previewSubscribers.delete(url);
  };
}

function preloadPreviewImage(data: PreviewData): Promise<void> {
  if (!data.image || typeof Image === "undefined") return Promise.resolve();
  const pending = previewImageRequests.get(data.image);
  if (pending) return pending;

  const request = new Promise<void>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      void (typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve())
        .finally(() => {
          rememberReadyPreviewImage(data.image);
          resolve();
        });
    };
    image.onload = finish;
    image.onerror = () => {
      settled = true;
      resolve();
    };
    image.src = data.image;
    if (image.complete && image.naturalWidth > 0) finish();
  });
  previewImageRequests.set(data.image, request);
  return request;
}

function isYouTubeUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname === "youtu.be"
      || hostname === "www.youtu.be"
      || hostname === "youtube.com"
      || hostname.endsWith(".youtube.com")
      || hostname === "youtube-nocookie.com"
      || hostname.endsWith(".youtube-nocookie.com");
  } catch {
    return false;
  }
}

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

function fetchPreviewNow(url: string, forceRefresh: boolean): Promise<PreviewData | null> {
  return fetch(`/api/preview?url=${encodeURIComponent(url)}`)
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
    });
}

function drainPreviewRequestQueue() {
  while (activePreviewRequests < MAX_CONCURRENT_PREVIEW_REQUESTS) {
    const visibleIndex = previewRequestQueue.findIndex((entry) => entry.priority === "visible");
    const nextIndex = visibleIndex >= 0
      ? visibleIndex
      : activePreviewRequests === 0 ? 0 : -1;
    if (nextIndex < 0 || nextIndex >= previewRequestQueue.length) return;

    const [next] = previewRequestQueue.splice(nextIndex, 1);
    activePreviewRequests += 1;
    void fetchPreviewNow(next.url, next.forceRefresh)
      .then(next.resolve)
      .finally(() => {
        activePreviewRequests -= 1;
        previewRequests.delete(next.url);
        drainPreviewRequestQueue();
      });
  }
}

function requestPreview(
  url: string,
  forceRefresh = false,
  priority: "visible" | "background" = "visible",
): Promise<PreviewData | null> {
  const pending = previewRequests.get(url);
  if (pending) {
    const queued = previewRequestQueue.find((entry) => entry.url === url);
    if (queued && priority === "visible") queued.priority = "visible";
    drainPreviewRequestQueue();
    return pending;
  }

  const request = new Promise<PreviewData | null>((resolve) => {
    previewRequestQueue.push({ url, forceRefresh, priority, resolve });
    drainPreviewRequestQueue();
  });
  previewRequests.set(url, request);
  return request;
}

async function primePreview(url: string) {
  const cached = await readCachedPreview(url);
  if (cached) {
    await preloadPreviewImage(cached.data);
    notifyPreviewSubscribers(url, cached.data);
    if (!cached.isStale) return;
  }
  if (!cached && previewCache.has(url)) return;
  const result = await requestPreview(url, !!cached, "background");
  if (!result) return;
  await preloadPreviewImage(result);
  notifyPreviewSubscribers(url, result);
}

function mountedPreviewDistance(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  if (rect.bottom < 0) return -rect.bottom;
  if (rect.top > window.innerHeight) return rect.top - window.innerHeight;
  return 0;
}

function shouldSkipMountedPreviewPrefetch(): boolean {
  const connection = getPreviewConnection();
  return connection?.saveData === true || connection?.effectiveType?.includes("2g") === true;
}

function getPreviewConnection() {
  return (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
}

function getEmbedPreviewRootMargin(): string {
  const connection = getPreviewConnection();
  if (connection?.saveData === true || connection?.effectiveType?.includes("2g")) {
    return "240px";
  }
  if (connection?.effectiveType === "3g") return "720px";
  return "1440px";
}

function scheduleMountedPreviewPrefetch() {
  const path = window.location.pathname;
  if (mountedPrefetchPath !== path) {
    mountedPrefetchPath = path;
    mountedPrefetchBudget = MOUNTED_PREVIEW_PREFETCH_LIMIT;
  }
  if (mountedPrefetchScheduled || mountedPrefetchBudget <= 0) return;
  mountedPrefetchScheduled = true;

  const run = () => {
    mountedPrefetchScheduled = false;
    if (shouldSkipMountedPreviewPrefetch()) {
      mountedPrefetchBudget = 0;
      return;
    }

    const nearestUrls = [...document.querySelectorAll<HTMLElement>("[data-message-preview-url]")]
      .sort((left, right) => mountedPreviewDistance(left) - mountedPreviewDistance(right))
      .map((element) => element.dataset.messagePreviewUrl || "")
      .filter((url, index, urls) =>
        Boolean(url)
        && urls.indexOf(url) === index
        && !previewCache.has(url)
        && !previewRequests.has(url))
      .slice(0, mountedPrefetchBudget);
    mountedPrefetchBudget -= nearestUrls.length;
    nearestUrls.forEach((url) => {
      void primePreview(url);
    });
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 1_500 });
  } else {
    globalThis.setTimeout(run, 250);
  }
}

function ensureHistoryPrefetchListener() {
  if (historyPrefetchListenerInstalled) return;
  historyPrefetchListenerInstalled = true;
  const replenishMountedPreviewPrefetch = () => {
    mountedPrefetchBudget = Math.max(
      mountedPrefetchBudget,
      MOUNTED_PREVIEW_PREFETCH_LIMIT,
    );
    scheduleMountedPreviewPrefetch();
  };
  window.addEventListener("chat-history-preload", replenishMountedPreviewPrefetch);
  window.addEventListener("chat-history-mounted", replenishMountedPreviewPrefetch);
}

function useDeferredEmbedVisibility() {
  const targetRef = useRef<HTMLAnchorElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const activateForNavigation = () => setIsVisible(true);
    const target = targetRef.current;
    window.addEventListener("chat-history-preload", activateForNavigation);
    target?.addEventListener("chat-history-preview-activate", activateForNavigation);
    return () => {
      window.removeEventListener("chat-history-preload", activateForNavigation);
      target?.removeEventListener("chat-history-preview-activate", activateForNavigation);
    };
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
    }, { rootMargin: getEmbedPreviewRootMargin() });

    observer.observe(target);
    return () => observer.disconnect();
  }, [isVisible]);

  return { targetRef, isVisible };
}

function PreviewImage({
  src,
  preserveFullImage,
  isMine,
}: {
  src: string;
  preserveFullImage: boolean;
  isMine: boolean;
}) {
  const [loaded, setLoaded] = useState(readyPreviewImages.has(src));
  const [failed, setFailed] = useState(false);

  return (
    <div
      className="preview-media-frame"
      style={{
        aspectRatio: preserveFullImage ? "1 / 1" : "2 / 1",
        maxHeight: preserveFullImage ? "320px" : "160px",
        background: preserveFullImage
          ? (isMine ? "rgba(0,0,0,.15)" : "rgba(0,0,0,.05)")
          : undefined,
      }}
    >
      {!loaded && !failed && (
        <div className="preview-media-skeleton" data-history-layout-pending aria-hidden="true" />
      )}
      <img
        src={src}
        alt=""
        className={`media-load-fade${loaded ? " is-loaded" : ""}`}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: failed ? "none" : "block",
          objectFit: preserveFullImage ? "contain" : "cover",
        }}
        onLoad={(event) => {
          const image = event.currentTarget;
          void (typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve())
            .finally(() => {
              rememberReadyPreviewImage(src);
              setLoaded(true);
            });
        }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function PreviewVideo({ src, poster }: { src: string; poster?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="preview-media-frame" style={{ aspectRatio: "2 / 1", maxHeight: "200px" }}>
      {!loaded && !failed && (
        <div className="preview-media-skeleton" data-history-layout-pending aria-hidden="true" />
      )}
      <video
        src={src}
        poster={poster}
        controls
        playsInline
        preload="metadata"
        className={`media-load-fade${loaded ? " is-loaded" : ""}`}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: failed ? "none" : "block", objectFit: "cover" }}
        onLoadedMetadata={() => setLoaded(true)}
        onError={() => setFailed(true)}
        onClick={(event) => event.preventDefault()}
      />
    </div>
  );
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
  const { targetRef, isVisible } = useDeferredEmbedVisibility();

  useEffect(() => subscribeToPreview(url, (preview) => {
    setData(preview);
    setHasResolved(true);
  }), [url]);

  useEffect(() => {
    ensureHistoryPrefetchListener();
    scheduleMountedPreviewPrefetch();
  }, [url]);

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
        data-message-preview-url={url}
        data-history-layout-pending
        style={{ position: "relative", width: "100%", height: 0, overflow: "visible" }}
        aria-hidden="true"
        tabIndex={-1}
      />
    );
  }
  if (!hasResolved) {
    return (
      <div className="link-preview-skeleton" data-history-layout-pending aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (!data) return null;

  const previewVideo = staticOnly ? "" : data.video;
  const hasTextMetadata = !!(data.title || data.description || data.siteName);
  const shouldPreserveFullImage = !!data.image && !previewVideo && !hasTextMetadata;

  return (
    <a
      ref={targetRef}
      data-message-preview-url={url}
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
        <PreviewVideo
          src={previewVideo}
          poster={data.image || undefined}
        />
      ) : data.image ? (
        <PreviewImage
          src={data.image}
          preserveFullImage={shouldPreserveFullImage}
          isMine={isMine}
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
    const staticOnly = isYouTubeUrl(url) || INSTAGRAM_REGEX.test(url);
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
