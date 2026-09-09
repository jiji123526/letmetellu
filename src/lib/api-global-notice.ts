export interface GlobalNotice {
  title: string;
  body: string;
  version: string;
}

export const GLOBAL_NOTICE_UPDATED_EVENT = "global-notice-updated";

const GLOBAL_NOTICE_CACHE_KEY = "yap_global_notice_cache_v1";
export const GLOBAL_NOTICE_BROWSER_CACHE_TTL_MS = 60 * 60 * 1_000;

interface GlobalNoticeCacheEntry {
  checkedAt: number;
  notice: GlobalNotice | null;
}

let memoryCache: GlobalNoticeCacheEntry | null = null;
let pendingRead: Promise<GlobalNotice | null> | null = null;

interface GlobalNoticeResponse {
  notice?: GlobalNotice | null;
  error?: string;
}

export function notifyGlobalNoticeUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GLOBAL_NOTICE_UPDATED_EVENT));
}

function isGlobalNotice(value: unknown): value is GlobalNotice {
  if (!value || typeof value !== "object") return false;
  const notice = value as Partial<GlobalNotice>;
  return typeof notice.title === "string"
    && typeof notice.body === "string"
    && typeof notice.version === "string";
}

function readCachedGlobalNotice(): GlobalNoticeCacheEntry | null {
  if (typeof window === "undefined") return null;
  if (memoryCache) return memoryCache;
  try {
    const raw = localStorage.getItem(GLOBAL_NOTICE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GlobalNoticeCacheEntry>;
    if (typeof parsed.checkedAt !== "number") return null;
    if (parsed.notice !== null && !isGlobalNotice(parsed.notice)) return null;
    memoryCache = {
      checkedAt: parsed.checkedAt,
      notice: parsed.notice ?? null,
    };
    return memoryCache;
  } catch {
    return null;
  }
}

function writeCachedGlobalNotice(notice: GlobalNotice | null) {
  if (typeof window === "undefined") return;
  const entry: GlobalNoticeCacheEntry = {
    checkedAt: Date.now(),
    notice,
  };
  memoryCache = entry;
  try {
    localStorage.setItem(GLOBAL_NOTICE_CACHE_KEY, JSON.stringify(entry));
  } catch {}
}

export async function fetchGlobalNotice(options: { force?: boolean } = {}): Promise<GlobalNotice | null> {
  if (!options.force) {
    const cached = readCachedGlobalNotice();
    if (cached && Date.now() - cached.checkedAt < GLOBAL_NOTICE_BROWSER_CACHE_TTL_MS) {
      return cached.notice;
    }
    if (pendingRead) return pendingRead;
  }

  const request = (async () => {
    const response = await fetch("/api/global-notice", { cache: "no-store" });
    const data = await response.json() as GlobalNoticeResponse;
    if (!response.ok) {
      throw new Error(data.error || `global notice load failed: ${response.status}`);
    }
    const notice = data.notice || null;
    writeCachedGlobalNotice(notice);
    return notice;
  })();

  if (!options.force) pendingRead = request;
  try {
    return await request;
  } finally {
    if (pendingRead === request) pendingRead = null;
  }
}

export async function saveGlobalNotice(input: {
  title: string;
  body: string;
}): Promise<GlobalNotice> {
  const response = await fetch("/api/global-notice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const data = await response.json() as GlobalNoticeResponse;
  if (!response.ok || !data.notice) {
    throw new Error(data.error || `global notice save failed: ${response.status}`);
  }
  writeCachedGlobalNotice(data.notice);
  return data.notice;
}

export async function clearGlobalNotice(): Promise<void> {
  const response = await fetch("/api/global-notice", {
    method: "DELETE",
    cache: "no-store",
  });
  const data = await response.json() as GlobalNoticeResponse;
  if (!response.ok) {
    throw new Error(data.error || `global notice clear failed: ${response.status}`);
  }
  writeCachedGlobalNotice(null);
}
