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

interface PreviewData {
  title: string;
  description: string;
  image: string;
  video: string;
  siteName: string;
  url: string;
}

const previewCache = new Map<string, PreviewData | null>();

function YouTubeEmbed({ url }: { url: string }) {
  const [loading, setLoading] = useState(true);
  const match = url.match(YOUTUBE_REGEX);
  if (!match) return null;
  const videoId = match[1];
  const isShorts = url.includes("/shorts/");

  return (
    <div style={{
      position: "relative",
      borderRadius: "12px",
      overflow: "hidden",
      width: "min(320px, 100%)",
      maxWidth: "100%",
      background: "#000",
      aspectRatio: isShorts ? "9/16" : "16/9",
    }}>
      {loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", background: "var(--gray-bubble)" }}>
          <MediaLoadingDots />
        </div>
      )}
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

function LinkPreviewCard({ url }: { url: string }) {
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
        } else {
          previewCache.set(url, null);
        }
      })
      .catch(() => { previewCache.set(url, null); })
      .finally(() => setLoading(false));
  }, [url]);

  if (loading) return <MediaLoadingDots minHeight="72px" />;
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
        border: "1px solid var(--hairline)",
        background: "var(--card)",
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
          <div style={{ fontSize: "calc(var(--bubble-font-size) - 2px)", fontWeight: 500, color: "var(--gray-text)", lineHeight: 1.3, marginBottom: "2px" }}>
            {data.title.length > 60 ? data.title.slice(0, 60) + "…" : data.title}
          </div>
        )}
        {data.description && (
          <div style={{ fontSize: "calc(var(--bubble-font-size) - 4px)", color: "var(--meta)", lineHeight: 1.3 }}>
            {data.description.length > 80 ? data.description.slice(0, 80) + "…" : data.description}
          </div>
        )}
      </div>
    </a>
  );
}

function TwitterEmbed({ url }: { url: string }) {
  const tweetId = url.match(/status\/(\d+)/)?.[1];
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!tweetId || !container) return;

    const render = () => {
      if (window.twttr?.widgets?.createTweet) {
        window.twttr.widgets.createTweet(tweetId, container, {
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          conversation: "none",
          width: Math.min(320, container.clientWidth || 320),
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
  }, [tweetId]);

  if (!tweetId) return null;

  return (
    <div
      className="native-chat-embed"
      style={{ position: "relative", width: "min(320px, 100%)", maxWidth: "100%", minHeight: "80px", overflow: "hidden", borderRadius: "12px" }}
    >
      {loading && <div style={{ position: "absolute", inset: 0, zIndex: 1, background: "var(--gray-bubble)" }}><MediaLoadingDots minHeight="80px" /></div>}
      <div ref={containerRef} style={{ width: "100%" }} />
    </div>
  );
}

function InstagramEmbed({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = `<blockquote class="instagram-media" data-instgrm-permalink="${url}" data-instgrm-version="14" style="max-width:100%;width:100%;min-width:0;margin:0;border:0;border-radius:12px;background:var(--card);"></blockquote>`;

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
  }, [url]);

  return (
    <div
      className="native-chat-embed"
      style={{ position: "relative", width: "min(320px, 100%)", maxWidth: "100%", minHeight: "80px", overflow: "hidden", borderRadius: "12px" }}
    >
      {loading && <div style={{ position: "absolute", inset: 0, zIndex: 1, background: "var(--gray-bubble)" }}><MediaLoadingDots minHeight="80px" /></div>}
      <div ref={containerRef} style={{ width: "100%" }} />
    </div>
  );
}

// Main export: renders embeds for URLs found in message text
export function MessageEmbeds({ text }: { text: string }) {
  const urls = text.match(URL_REGEX);
  if (!urls || urls.length === 0) return null;

  // Deduplicate
  const unique = [...new Set(urls)];

  return (
    <div style={{
      marginTop: "6px",
      overflow: "visible",
      width: "min(320px, 100%)",
      maxWidth: "100%",
    }}>
      {unique.map((url) => {
        // YouTube — inline iframe
        if (YOUTUBE_REGEX.test(url)) {
          return <YouTubeEmbed key={url} url={url} />;
        }
        // Twitter/X — native widget
        if (TWITTER_REGEX.test(url)) {
          return <TwitterEmbed key={url} url={url} />;
        }
        // Instagram — native widget
        if (INSTAGRAM_REGEX.test(url)) {
          return <InstagramEmbed key={url} url={url} />;
        }
        // Other URLs — OG link preview
        return <LinkPreviewCard key={url} url={url} />;
      })}
    </div>
  );
}
