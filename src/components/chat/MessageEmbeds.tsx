"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MediaLoadingDots } from "./MediaLoadingDots";

interface InstagramEmbeds {
  process: () => void;
}

declare global {
  interface Window {
    instgrm?: { Embeds?: InstagramEmbeds };
  }
}

// URL patterns
const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/;
const TWITTER_REGEX = /https?:\/\/(twitter\.com|x\.com)\/\w+\/status\/(\d+)/;
const INSTAGRAM_REGEX = /https?:\/\/(www\.)?instagram\.com\/(p|reel)\/[\w-]+/;
const URL_REGEX = /https?:\/\/[^\s<]+/g;
const NATIVE_EMBED_WIDTH = 320;
const EMBED_PREVIEW_ROOT_MARGIN = "720px";

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
}

let instagramScriptPromise: Promise<InstagramEmbeds | null> | null = null;
let instagramProcessTimer: ReturnType<typeof setTimeout> | null = null;
let instagramPreloadScheduled = false;

function getNetworkInformation(): NetworkInformationLike | undefined {
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

function getEmbedPreloadMargin() {
  const connection = getNetworkInformation();
  if (connection?.saveData || connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") {
    return "300px 0px";
  }
  if (connection?.effectiveType === "3g") return "600px 0px";
  return "1000px 0px";
}

function loadInstagramEmbeds(): Promise<InstagramEmbeds | null> {
  if (window.instgrm?.Embeds) return Promise.resolve(window.instgrm.Embeds);
  if (instagramScriptPromise) return instagramScriptPromise;

  instagramScriptPromise = new Promise((resolve) => {
    const existing = document.getElementById("insta-embed-js") as HTMLScriptElement | null;
    const script = existing || document.createElement("script");
    const finish = () => resolve(window.instgrm?.Embeds || null);
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => resolve(null), { once: true });
    if (!existing) {
      script.id = "insta-embed-js";
      script.src = "https://www.instagram.com/embed.js";
      script.async = true;
      document.body.appendChild(script);
    }
  });
  return instagramScriptPromise;
}

function scheduleInstagramProcess(embeds: InstagramEmbeds) {
  if (instagramProcessTimer) return;
  instagramProcessTimer = setTimeout(() => {
    instagramProcessTimer = null;
    embeds.process();
  }, 0);
}

function scheduleIdleInstagramPreload() {
  if (instagramPreloadScheduled) return;
  instagramPreloadScheduled = true;

  const preload = () => {
    void loadInstagramEmbeds();
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(preload, { timeout: 2000 });
  } else {
    setTimeout(preload, 500);
  }
}

function LazyEmbed({ render, fillWidth }: { render: () => ReactNode; fillWidth: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const activateForNavigation = () => setActive(true);
    window.addEventListener("chat-history-preload", activateForNavigation);
    return () => window.removeEventListener("chat-history-preload", activateForNavigation);
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    if (!("IntersectionObserver" in window)) {
      const fallbackTimer = setTimeout(() => {
        setActive(true);
      }, 0);
      return () => clearTimeout(fallbackTimer);
    }
    const preloadObserver = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setActive(true);
      preloadObserver.disconnect();
    }, { rootMargin: getEmbedPreloadMargin() });
    preloadObserver.observe(element);
    return () => preloadObserver.disconnect();
  }, []);

  return (
    <div ref={rootRef} style={{ width: fillWidth ? "100%" : "fit-content", maxWidth: "100%" }}>
      {active ? render() : <MediaLoadingDots />}
    </div>
  );
}

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

function normalizeInstagramEmbedUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "instagram.com" && hostname !== "www.instagram.com") return null;
    if (!/^\/(p|reel)\/[\w-]+\/?$/i.test(parsed.pathname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
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

function useResponsiveEmbedScale() {
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState(80);

  useEffect(() => {
    const frame = frameRef.current;
    const content = contentRef.current;
    if (!frame || !content) return;

    const updateSize = () => {
      const nextScale = Math.min(1, frame.clientWidth / NATIVE_EMBED_WIDTH);
      const naturalHeight = Math.max(80, content.scrollHeight);
      setScale(nextScale);
      setScaledHeight(naturalHeight * nextScale);
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(frame);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return { frameRef, contentRef, scale, scaledHeight };
}

function YouTubeEmbed({ url, onReady }: { url: string; onReady: (url: string) => void }) {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    onReady(url);
  }, [onReady, url]);

  const match = url.match(YOUTUBE_REGEX);
  if (!match) return null;
  const videoId = match[1];
  const isShorts = url.includes("/shorts/");

  return (
    <div style={{
      position: "relative",
      borderRadius: "12px",
      overflow: "hidden",
      width: loading ? "auto" : "min(320px, 100%)",
      maxWidth: "100%",
      background: loading ? "transparent" : "#000",
      aspectRatio: loading ? undefined : (isShorts ? "9/16" : "16/9"),
    }}>
      {loading && <MediaLoadingDots />}
      <iframe
        loading="lazy"
        width="100%"
        height="100%"
        src={`https://www.youtube.com/embed/${videoId}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        onLoad={() => setLoading(false)}
        style={{ display: loading ? "none" : "block", border: 0 }}
      />
    </div>
  );
}

function LinkPreviewCard({ url, isMine, onReady }: { url: string; isMine: boolean; onReady: (url: string) => void }) {
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

  const hasTextMetadata = !!(data.title || data.description || data.siteName);
  const shouldPreserveFullImage = !!data.image && !data.video && !hasTextMetadata;

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
      {data.video ? (
        <video
          src={data.video}
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

function InstagramEmbed({ url, onReady }: { url: string; onReady: (url: string) => void }) {
  const { frameRef, contentRef, scale, scaledHeight } = useResponsiveEmbedScale();
  const [loading, setLoading] = useState(true);
  const embedUrl = normalizeInstagramEmbedUrl(url);

  useEffect(() => {
    onReady(url);
  }, [onReady, url]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container || !embedUrl) return;

    container.replaceChildren();
    const blockquote = document.createElement("blockquote");
    blockquote.className = "instagram-media";
    blockquote.dataset.instgrmPermalink = embedUrl;
    blockquote.dataset.instgrmVersion = "14";
    Object.assign(blockquote.style, {
      maxWidth: `${NATIVE_EMBED_WIDTH}px`,
      width: `${NATIVE_EMBED_WIDTH}px`,
      minWidth: "0",
      margin: "0",
      border: "0",
      borderRadius: "12px",
      background: "var(--card)",
    });
    container.appendChild(blockquote);

    const observer = new MutationObserver(() => {
      if (container.querySelector("iframe")) {
        setLoading(false);
        observer.disconnect();
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    let cancelled = false;
    void loadInstagramEmbeds().then((embeds) => {
      if (!embeds || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }
      scheduleInstagramProcess(embeds);
    });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [embedUrl, url, contentRef]);

  if (!embedUrl) return null;

  return (
    <div
      ref={frameRef}
      className="native-chat-embed"
      style={{ position: "relative", width: loading ? "auto" : `${NATIVE_EMBED_WIDTH}px`, maxWidth: "100%", height: loading ? "calc(var(--bubble-font-size) * 1.38)" : `${scaledHeight}px`, overflow: "hidden", borderRadius: "12px" }}
    >
      {loading && <MediaLoadingDots />}
      <div
        ref={contentRef}
        className="native-chat-embed-scale"
        style={{ position: "absolute", top: 0, left: 0, width: `${NATIVE_EMBED_WIDTH}px`, transform: `scale(${scale})`, transformOrigin: "top left", visibility: loading ? "hidden" : "visible" }}
      />
    </div>
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
  const hasInstagram = unique.some((url) => INSTAGRAM_REGEX.test(url));

  useEffect(() => {
    if (hasInstagram) scheduleIdleInstagramPreload();
  }, [hasInstagram]);

  if (unique.length === 0) return null;

  const renderEmbed = (url: string) => {
    // YouTube — inline iframe
    if (YOUTUBE_REGEX.test(url)) {
      return (
        <LazyEmbed
          fillWidth={fillWidth}
          render={() => <YouTubeEmbed url={url} onReady={onEmbedReady} />}
        />
      );
    }
    // Twitter/X — lightweight preview card via worker metadata
    if (TWITTER_REGEX.test(url)) {
      return <LinkPreviewCard url={url} isMine={isMine} onReady={onEmbedReady} />;
    }
    // Instagram — native widget
    if (INSTAGRAM_REGEX.test(url)) {
      return (
        <LazyEmbed
          fillWidth={fillWidth}
          render={() => <InstagramEmbed url={url} onReady={onEmbedReady} />}
        />
      );
    }
    // Other URLs — OG link preview
    return <LinkPreviewCard url={url} isMine={isMine} onReady={onEmbedReady} />;
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
