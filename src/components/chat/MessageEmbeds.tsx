"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MediaLoadingDots } from "./MediaLoadingDots";

interface TwitterWidgets {
  createTweet: (
    id: string,
    element: HTMLElement,
    options: { theme: string; conversation: string; width: number },
  ) => Promise<unknown>;
}

interface InstagramEmbeds {
  process: () => void;
}

declare global {
  interface Window {
    twttr?: { widgets?: TwitterWidgets; _e?: Array<() => void> };
    instgrm?: { Embeds?: InstagramEmbeds };
  }
}

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

// URL patterns
const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/;
const TWITTER_REGEX = /https?:\/\/(twitter\.com|x\.com)\/\w+\/status\/(\d+)/;
const INSTAGRAM_REGEX = /https?:\/\/(www\.)?instagram\.com\/(p|reel)\/[\w-]+/;
const URL_REGEX = /https?:\/\/[^\s<]+/g;
const NATIVE_EMBED_WIDTH = 320;
const EMBED_PRELOAD_MARGIN = "600px 0px";
const MAX_CONCURRENT_TWITTER_RENDERS = 2;
const WIDGET_RENDER_TIMEOUT_MS = 12_000;

let twitterScriptPromise: Promise<TwitterWidgets | null> | null = null;
const twitterRenderQueue: Array<() => Promise<void>> = [];
let activeTwitterRenders = 0;
let instagramScriptPromise: Promise<InstagramEmbeds | null> | null = null;
let instagramProcessTimer: ReturnType<typeof setTimeout> | null = null;

function loadTwitterWidgets(): Promise<TwitterWidgets | null> {
  if (window.twttr?.widgets) return Promise.resolve(window.twttr.widgets);
  if (twitterScriptPromise) return twitterScriptPromise;

  twitterScriptPromise = new Promise((resolve) => {
    window.twttr = window.twttr || { _e: [] };
    (window.twttr._e ||= []).push(() => resolve(window.twttr?.widgets || null));

    if (document.getElementById("twitter-wjs")) return;
    const script = document.createElement("script");
    script.id = "twitter-wjs";
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    script.onerror = () => resolve(null);
    document.body.appendChild(script);
  });
  return twitterScriptPromise;
}

function drainTwitterRenderQueue() {
  while (activeTwitterRenders < MAX_CONCURRENT_TWITTER_RENDERS && twitterRenderQueue.length > 0) {
    const task = twitterRenderQueue.shift();
    if (!task) return;
    activeTwitterRenders += 1;
    void task().finally(() => {
      activeTwitterRenders -= 1;
      drainTwitterRenderQueue();
    });
  }
}

function queueTwitterRender(task: () => Promise<void>) {
  twitterRenderQueue.push(task);
  drainTwitterRenderQueue();
}

async function waitForWidgetRender(task: Promise<unknown>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, WIDGET_RENDER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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

function LazyEmbed({ children, fillWidth }: { children: ReactNode; fillWidth: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    if (!("IntersectionObserver" in window)) {
      const fallbackTimer = setTimeout(() => setActive(true), 0);
      return () => clearTimeout(fallbackTimer);
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setActive(true);
      observer.disconnect();
    }, { rootMargin: EMBED_PRELOAD_MARGIN });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} style={{ width: fillWidth ? "100%" : "fit-content", maxWidth: "100%" }}>
      {active ? children : <MediaLoadingDots />}
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

const previewCache = new Map<string, PreviewData | null>();
const previewRequests = new Map<string, Promise<PreviewData | null>>();

function requestPreview(url: string): Promise<PreviewData | null> {
  const cached = previewCache.get(url);
  if (cached !== undefined) return Promise.resolve(cached);

  const pending = previewRequests.get(url);
  if (pending) return pending;

  const request = fetch(`${WORKER_URL}/api/preview?url=${encodeURIComponent(url)}`)
    .then((response) => response.ok ? response.json() as Promise<PreviewData | null> : null)
    .then((result) => {
      const normalized = result && (result.title || result.image) ? result : null;
      previewCache.set(url, normalized);
      return normalized;
    })
    .catch(() => {
      previewCache.set(url, null);
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
  const [loading, setLoading] = useState(!previewCache.has(url));

  useEffect(() => {
    if (previewCache.has(url)) return;

    requestPreview(url)
      .then((result) => {
        if (result) {
          setData(result);
          onReady(url);
        }
      })
      .finally(() => setLoading(false));
  }, [onReady, url]);

  useEffect(() => {
    if (data) onReady(url);
  }, [data, onReady, url]);

  if (loading) return <MediaLoadingDots />;
  if (!data) return null;

  return (
    <a
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
          style={{ width: "100%", display: "block", maxHeight: "160px", objectFit: "cover" }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : null}
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
    </a>
  );
}

function TwitterEmbed({ url, onReady }: { url: string; onReady: (url: string) => void }) {
  const tweetId = url.match(/status\/(\d+)/)?.[1];
  const { frameRef, contentRef, scale, scaledHeight } = useResponsiveEmbedScale();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onReady(url);
  }, [onReady, url]);

  useEffect(() => {
    const container = contentRef.current;
    if (!tweetId || !container) return;

    let cancelled = false;
    void loadTwitterWidgets().then((widgets) => {
      if (!widgets || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }
      queueTwitterRender(async () => {
        if (cancelled) return;
        container.replaceChildren();
        try {
          await waitForWidgetRender(widgets.createTweet(tweetId, container, {
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          conversation: "none",
          width: NATIVE_EMBED_WIDTH,
          }));
        } finally {
          if (!cancelled) setLoading(false);
        }
      });
    });
    return () => { cancelled = true; };
  }, [tweetId, contentRef]);

  if (!tweetId) return null;

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
  if (!urls || urls.length === 0) return null;

  // Deduplicate
  const unique = [...new Set(urls)];

  const renderEmbed = (url: string) => {
    // YouTube — inline iframe
    if (YOUTUBE_REGEX.test(url)) {
      return <YouTubeEmbed url={url} onReady={onEmbedReady} />;
    }
    // Twitter/X — native widget
    if (TWITTER_REGEX.test(url)) {
      return <TwitterEmbed url={url} onReady={onEmbedReady} />;
    }
    // Instagram — native widget
    if (INSTAGRAM_REGEX.test(url)) {
      return <InstagramEmbed url={url} onReady={onEmbedReady} />;
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
        <LazyEmbed key={url} fillWidth={fillWidth}>
          {renderEmbed(url)}
        </LazyEmbed>
      ))}
    </div>
  );
}
