export interface GlobalNotice {
  title: string;
  body: string;
  version: string;
}

export const GLOBAL_NOTICE_UPDATED_EVENT = "global-notice-updated";

interface GlobalNoticeResponse {
  notice?: GlobalNotice | null;
  error?: string;
}

export function notifyGlobalNoticeUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GLOBAL_NOTICE_UPDATED_EVENT));
}

export async function fetchGlobalNotice(): Promise<GlobalNotice | null> {
  const response = await fetch("/api/global-notice", { cache: "no-store" });
  const data = await response.json() as GlobalNoticeResponse;
  if (!response.ok) {
    throw new Error(data.error || `global notice load failed: ${response.status}`);
  }
  return data.notice || null;
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
}
