"use client";

import { useEffect, useRef, useState } from "react";
import { MediaLoadingDots } from "./MediaLoadingDots";

interface InstagramEmbeds {
  process: () => void;
}

declare global {
  interface Window {
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
const EMBED_PREVIEW_ROOT_MARGIN = "720px";

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

function useDeferredEmbedVisibility(rootMargin: string) {
  const targetRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

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
    if (previewCache.has(url)) return;
    if (!isVisible) return;

    let cancelled = false;
    requestPreview(url)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setHasResolved(true);
      })
      .catch(() => {
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
      <div style={{ position: "relative", width: "100%", height: 0, overflow: "visible" }} aria-hidden="true">
        <div
          ref={targetRef}
          style={{ position: "absolute", inset: 0, height: "1px", pointerEvents: "none" }}
        />
      </div>
    );
  }
  if (!hasResolved) return null;
  if (!data) return null;

  const hasTextMetadata = !!(data.title || data.description || data.siteName);
  const shouldPreserveFullImage = !!data.image && !data.video && !hasTextMetadata;

  return (
    <a
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

    const process = () => {
      if (window.instgrm?.Embeds?.process) {
        window.instgrm.Embeds.process();
      }
    };

    if (window.instgrm) {
      process();
    } else if (!document.getElementById("insta-embed-js")) {
      const script = document.createElement("script");
      script.id = "insta-embed-js";
      script.src = "https://www.instagram.com/embed.js";
      script.async = true;
      script.onload = process;
      document.body.appendChild(script);
    } else {
      setTimeout(process, 1000);
    }

    return () => observer.disconnect();
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
    // Twitter/X — lightweight preview card via worker metadata
    if (TWITTER_REGEX.test(url)) {
      return <LinkPreviewCard url={url} isMine={isMine} onReady={onEmbedReady} />;
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
        <div key={url} style={{ width: fillWidth ? "100%" : undefined, maxWidth: "100%" }}>
          {renderEmbed(url)}
        </div>
      ))}
    </div>
  );
}
