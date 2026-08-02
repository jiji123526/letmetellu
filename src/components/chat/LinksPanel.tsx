"use client";

import { useEffect, useState, useRef, useCallback, type RefObject } from "react";
import { fetchLinks, fetchPreview } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";
import { chatDateLabel } from "@/lib/chat-date";

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
const previewRequests = new Map<string, Promise<{ title?: string; image?: string; siteName?: string } | null>>();
const previewQueue: Array<() => void> = [];
const MAX_CONCURRENT_PREVIEWS = 3;
let activePreviewRequests = 0;

function drainPreviewQueue() {
  while (activePreviewRequests < MAX_CONCURRENT_PREVIEWS && previewQueue.length > 0) {
    activePreviewRequests += 1;
    previewQueue.shift()?.();
  }
}

function requestPreview(url: string) {
  if (previewCache.has(url)) return Promise.resolve(previewCache.get(url) ?? null);
  const pending = previewRequests.get(url);
  if (pending) return pending;

  const request = new Promise<{ title?: string; image?: string; siteName?: string } | null>((resolve) => {
    previewQueue.push(() => {
      fetchPreview(url)
        .then((data) => data && (data.title || data.image)
          ? { title: data.title, image: data.image, siteName: data.siteName }
          : null)
        .catch(() => null)
        .then((preview) => {
          previewCache.set(url, preview);
          resolve(preview);
        })
        .finally(() => {
          activePreviewRequests -= 1;
          previewRequests.delete(url);
          drainPreviewQueue();
        });
    });
    drainPreviewQueue();
  });
  previewRequests.set(url, request);
  return request;
}

function LinkPreviewCard({
  link,
  scrollRootRef,
  onPreview,
  onClick,
}: {
  link: LinkItem;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  onPreview: (url: string, preview: LinkItem["preview"]) => void;
  onClick: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (link.preview !== undefined) return;
    const card = cardRef.current;
    const root = scrollRootRef.current;
    if (!card || !root) return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void requestPreview(link.url).then((preview) => {
        if (!cancelled) onPreview(link.url, preview);
      });
    }, { root, rootMargin: "160px 0px" });
    observer.observe(card);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [link.preview, link.url, onPreview, scrollRootRef]);

  return (
    <div
      ref={cardRef}
      className="cursor-pointer"
      style={{ border: "1px solid var(--hairline)", borderRadius: "12px", overflow: "hidden", transition: "background .15s" }}
      onClick={onClick}
    >
      {link.preview && link.preview.image ? (
        <img src={link.preview.image} alt="" style={{ width: "100%", maxHeight: "80px", objectFit: "cover", display: "block" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ) : null}
      <div style={{ padding: "8px 10px" }}>
        {link.preview?.siteName && (
          <div style={{ fontSize: "calc(var(--bubble-font-size) - 6px)", color: "var(--meta)", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.3px" }}>{link.preview.siteName}</div>
        )}
        {link.preview?.title ? (
          <div style={{ fontSize: "calc(var(--bubble-font-size) - 4px)", fontWeight: 400, color: "var(--gray-text)", lineHeight: 1.3 }}>
            {link.preview.title.length > 30 ? link.preview.title.slice(0, 30) + "…" : link.preview.title}
          </div>
        ) : (
          <div style={{ fontSize: "calc(var(--bubble-font-size) - 4px)", color: "var(--bubble-sent)", wordBreak: "break-all", lineHeight: 1.3 }}>
            {link.url.replace(/^https?:\/\//, "").slice(0, 25)}…
          </div>
        )}
      </div>
    </div>
  );
}

export function LinksPanel({ channelId, onNavigate, onClose }: LinksPanelProps) {
  const { t, locale, timeZone } = useLocale();
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

  const applyPreview = useCallback((url: string, preview: LinkItem["preview"]) => {
    setLinks((previous) => previous.map((link) => link.url === url ? { ...link, preview } : link));
  }, []);

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
            {" "}{t("linksTitle")}
          </h3>
          <button
            className="bg-transparent border-none cursor-pointer"
            style={{ fontSize: "18px", color: "var(--meta)", padding: "4px 8px" }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Links grid */}
        <div ref={scrollRef} onScroll={handleScroll} className="overflow-y-auto flex-1" style={{ padding: "8px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", alignContent: "start" }}>
          {loading ? (
            <div style={{ gridColumn: "1 / -1", padding: "40px", textAlign: "center", color: "var(--meta)", fontSize: "var(--bubble-font-size, 14px)" }}>{t("loading")}</div>
          ) : links.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", padding: "40px", textAlign: "center", color: "var(--meta)", fontSize: "var(--bubble-font-size, 14px)" }}>{t("linksEmpty")}</div>
          ) : (
            <>
              {(() => {
                let lastDate = "";
                return links.flatMap((link, i) => {
                  const dateLabel = chatDateLabel(link.date, locale, timeZone);
                  const showDivider = Boolean(dateLabel) && dateLabel !== lastDate;
                  lastDate = dateLabel;
                  return [
                    ...(showDivider ? [(
                      <div key={`date-${dateLabel}-${i}`} style={{ gridColumn: "1 / -1", fontSize: "calc(var(--bubble-font-size, 15px) - 3px)", color: "var(--meta)", padding: "8px 4px 0", fontWeight: 400 }}>
                        {dateLabel}
                      </div>
                    )] : []),
                    <LinkPreviewCard
                      key={`${link.url}-${i}`}
                      link={link}
                      scrollRootRef={scrollRef}
                      onPreview={applyPreview}
                      onClick={() => {
                        if (onNavigate) {
                          onClose();
                          setTimeout(() => onNavigate(link.msgId), 100);
                        } else {
                          window.open(link.url, "_blank");
                        }
                      }}
                    />,
                  ];
                });
              })()}
              {hasMore && (
                <div style={{ gridColumn: "1 / -1", padding: "12px", textAlign: "center" }}>
                  <span style={{ fontSize: "calc(var(--bubble-font-size) - 4px)", color: "var(--meta)" }}>{t("loading")}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
