"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { fetchLinks, fetchPreview } from "@/lib/api";

const URL_REGEX = /(https?:\/\/[^\s<]+|(?:www\.|(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|dev|app|co|me|tv|gg|xyz|kr|jp))[^\s]*)/g;

interface LinkItem {
  url: string;
  msgId: string;
  date: string;
  preview?: { title?: string; image?: string; siteName?: string } | null;
}

interface LinksPanelProps {
  channelId: string;
  onNavigate?: (msgId: string) => void;
  onClose: () => void;
}

const previewCache = new Map<string, { title?: string; image?: string; siteName?: string } | null>();

export function LinksPanel({ channelId, onNavigate, onClose }: LinksPanelProps) {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const loadingMore = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Extract links from messages returned by server
  const extractLinks = (messages: { id: string; text: string; created_at: string }[]): LinkItem[] => {
    const found: LinkItem[] = [];
    messages.forEach((m) => {
      if (m.text) {
        const matches = m.text.match(URL_REGEX);
        if (matches) {
          matches.forEach((url) => {
            const fullUrl = url.startsWith("http") ? url : `https://${url}`;
            found.push({ url: fullUrl, msgId: m.id, date: m.created_at });
          });
        }
      }
    });
    return found;
  };

  // Deduplicate by URL
  const dedup = (items: LinkItem[]): LinkItem[] => {
    const seen = new Map<string, LinkItem>();
    items.forEach((l) => { if (!seen.has(l.url)) seen.set(l.url, l); });
    return [...seen.values()];
  };

  // Load initial links
  useEffect(() => {
    setLoading(true);
    fetchLinks(channelId).then((data) => {
      if (data.links) {
        const extracted = extractLinks(data.links);
        setLinks(dedup(extracted));
        if (data.links.length < 30) setHasMore(false);
      }
      setLoading(false);
    });
  }, [channelId]);

  // Fetch OG previews for visible links
  useEffect(() => {
    links.forEach((link, i) => {
      if (link.preview !== undefined) return; // already fetched or failed

      if (previewCache.has(link.url)) {
        setLinks((prev) => prev.map((l, j) => j === i ? { ...l, preview: previewCache.get(l.url) } : l));
        return;
      }

      fetchPreview(link.url).then((data) => {
        const preview = data && (data.title || data.image) ? { title: data.title, image: data.image, siteName: data.siteName } : null;
        previewCache.set(link.url, preview);
        setLinks((prev) => prev.map((l) => l.url === link.url ? { ...l, preview } : l));
      }).catch(() => {
        previewCache.set(link.url, null);
        setLinks((prev) => prev.map((l) => l.url === link.url ? { ...l, preview: null } : l));
      });
    });
  }, [links.length]);

  // Load more on scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || loadingMore.current) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      loadingMore.current = true;
      const oldest = links[links.length - 1];
      const cursor = oldest?.date;
      fetchLinks(channelId, cursor).then((data) => {
        if (data.links && data.links.length > 0) {
          const extracted = extractLinks(data.links);
          setLinks((prev) => dedup([...prev, ...extracted]));
          if (data.links.length < 30) setHasMore(false);
        } else {
          setHasMore(false);
        }
      }).finally(() => { loadingMore.current = false; });
    }
  }, [links, hasMore, channelId]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center animate-[ctxFade_0.2s_ease]"
      style={{
        background: "rgba(0,0,0,.4)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        padding: "24px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[360px] max-h-[80vh] rounded-[16px] overflow-hidden flex flex-col"
        style={{ background: "var(--bg)", color: "var(--gray-text)", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between flex-none" style={{ padding: "16px 18px", borderBottom: "0.5px solid var(--hairline)" }}>
          <h3 className="m-0 font-medium" style={{ fontSize: "var(--bubble-font-size, 16px)" }}>
            <svg viewBox="0 0 24 24" width="16" height="16" style={{ verticalAlign: "-2px", display: "inline" }}>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {" "}Links
          </h3>
          <button
            className="bg-transparent border-none cursor-pointer"
            style={{ fontSize: "18px", color: "var(--meta)", padding: "4px 8px" }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Links list */}
        <div ref={scrollRef} onScroll={handleScroll} className="overflow-y-auto flex-1" style={{ padding: "8px" }}>
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--meta)", fontSize: "var(--bubble-font-size, 14px)" }}>Loading...</div>
          ) : links.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--meta)", fontSize: "var(--bubble-font-size, 14px)" }}>No links shared</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {links.map((link, i) => (
                <div
                  key={`${link.url}-${i}`}
                  className="cursor-pointer"
                  style={{
                    border: "1px solid var(--hairline)",
                    borderRadius: "12px",
                    overflow: "hidden",
                    transition: "background .15s",
                  }}
                  onClick={() => {
                    if (onNavigate) {
                      onClose();
                      setTimeout(() => onNavigate(link.msgId), 100);
                    } else {
                      window.open(link.url, "_blank");
                    }
                  }}
                >
                  {/* Preview card or fallback URL */}
                  {link.preview && link.preview.image ? (
                    <img
                      src={link.preview.image}
                      alt=""
                      style={{ width: "100%", height: "120px", objectFit: "cover", display: "block" }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : null}
                  <div style={{ padding: "10px 12px" }}>
                    {link.preview?.siteName && (
                      <div style={{ fontSize: "calc(var(--bubble-font-size) - 5px)", color: "var(--meta)", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.3px" }}>
                        {link.preview.siteName}
                      </div>
                    )}
                    {link.preview?.title ? (
                      <div style={{ fontSize: "calc(var(--bubble-font-size) - 2px)", fontWeight: 500, color: "var(--gray-text)", lineHeight: 1.3 }}>
                        {link.preview.title.length > 50 ? link.preview.title.slice(0, 50) + "…" : link.preview.title}
                      </div>
                    ) : (
                      <div style={{ fontSize: "calc(var(--bubble-font-size) - 3px)", color: "var(--bubble-sent)", wordBreak: "break-all", lineHeight: 1.3 }}>
                        {link.url.length > 60 ? link.url.slice(0, 60) + "…" : link.url}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {hasMore && (
                <div style={{ padding: "12px", textAlign: "center" }}>
                  <span style={{ fontSize: "calc(var(--bubble-font-size) - 4px)", color: "var(--meta)" }}>Loading...</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
