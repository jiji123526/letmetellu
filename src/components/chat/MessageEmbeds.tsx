"use client";

import { useEffect, useRef, useState } from "react";
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

interface PreviewData {
  title: string;
  description: string;
  image: string;
  video: string;
  siteName: string;
  url: string;
}

const previewCache = new Map<string, PreviewData | null>();

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
  const [loading, setLoading] = useState(!previewCache.has(url));

  useEffect(() => {
    if (previewCache.has(url)) return;

    fetch(`${WORKER_URL}/api/preview?url=${encodeURIComponent(url)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((result: PreviewData | null) => {
        if (result && (result.title || result.image)) {
          previewCache.set(url, result);
          setData(result);
          onReady(url);
        } else {
          previewCache.set(url, null);
        }
      })
      .catch(() => { previewCache.set(url, null); })
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

    const render = () => {
      if (window.twttr?.widgets?.createTweet) {
        window.twttr.widgets.createTweet(tweetId, container, {
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          conversation: "none",
          width: NATIVE_EMBED_WIDTH,
        }).then(() => setLoading(false)).catch(() => setLoading(false));
      }
    };

    if (window.twttr?.widgets) {
      render();
    } else {
      if (!document.getElementById("twitter-wjs")) {
        const script = document.createElement("script");
        script.id = "twitter-wjs";
        script.src = "https://platform.twitter.com/widgets.js";
        script.async = true;
        document.body.appendChild(script);
      }
      window.twttr = window.twttr || { _e: [] };
      (window.twttr._e ||= []).push(render);
    }
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

  useEffect(() => {
    onReady(url);
  }, [onReady, url]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    container.innerHTML = `<blockquote class="instagram-media" data-instgrm-permalink="${url}" data-instgrm-version="14" style="max-width:${NATIVE_EMBED_WIDTH}px;width:${NATIVE_EMBED_WIDTH}px;min-width:0;margin:0;border:0;border-radius:12px;background:var(--card);"></blockquote>`;

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
  }, [url, contentRef]);

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
export function MessageEmbeds({ text, isMine, onEmbedReady }: { text: string; isMine: boolean; onEmbedReady: (url: string) => void }) {
  const urls = text.match(URL_REGEX);
  if (!urls || urls.length === 0) return null;

  // Deduplicate
  const unique = [...new Set(urls)];

  return (
    <div className="message-embeds" style={{
      marginTop: 0,
      overflow: "visible",
      width: "fit-content",
      maxWidth: "100%",
    }}>
      {unique.map((url) => {
        // YouTube — inline iframe
        if (YOUTUBE_REGEX.test(url)) {
          return <YouTubeEmbed key={url} url={url} onReady={onEmbedReady} />;
        }
        // Twitter/X — native widget
        if (TWITTER_REGEX.test(url)) {
          return <TwitterEmbed key={url} url={url} onReady={onEmbedReady} />;
        }
        // Instagram — native widget
        if (INSTAGRAM_REGEX.test(url)) {
          return <InstagramEmbed key={url} url={url} onReady={onEmbedReady} />;
        }
        // Other URLs — OG link preview
        return <LinkPreviewCard key={url} url={url} isMine={isMine} onReady={onEmbedReady} />;
      })}
    </div>
  );
}
