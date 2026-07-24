"use client";

import { useEffect, useState } from "react";

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
  const match = url.match(YOUTUBE_REGEX);
  if (!match) return null;
  const videoId = match[1];
  const isShorts = url.includes("/shorts/");

  return (
    <div style={{ borderRadius: "12px", overflow: "hidden", maxWidth: "300px", marginTop: "6px", background: "#000" }}>
      <iframe
        width="300"
        height={isShorts ? "534" : "169"}
        src={`https://www.youtube.com/embed/${videoId}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        style={{ display: "block", border: 0, maxWidth: "100%" }}
      />
    </div>
  );
}

function LinkPreviewCard({ url }: { url: string }) {
  const [data, setData] = useState<PreviewData | null>(previewCache.get(url) || null);
  const [loading, setLoading] = useState(!previewCache.has(url));

  useEffect(() => {
    if (previewCache.has(url)) {
      setData(previewCache.get(url)!);
      setLoading(false);
      return;
    }

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

  if (loading || !data) return null;

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "block",
        maxWidth: "300px",
        marginTop: "6px",
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

// Main export: renders embeds for URLs found in message text
export function MessageEmbeds({ text }: { text: string }) {
  const urls = text.match(URL_REGEX);
  if (!urls || urls.length === 0) return null;

  // Deduplicate
  const unique = [...new Set(urls)];

  return (
    <>
      {unique.map((url) => {
        // YouTube — inline iframe
        if (YOUTUBE_REGEX.test(url)) {
          return <YouTubeEmbed key={url} url={url} />;
        }
        // Twitter/X and Instagram — link preview card (native embeds are heavy/slow)
        if (TWITTER_REGEX.test(url) || INSTAGRAM_REGEX.test(url)) {
          return <LinkPreviewCard key={url} url={url} />;
        }
        // Other URLs — OG link preview
        return <LinkPreviewCard key={url} url={url} />;
      })}
    </>
  );
}
