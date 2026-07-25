export interface RecentChannel {
  id: string;
  name: string;
  profileImage: string | null;
  bubbleColor: string;
  lastVisitedAt: number;
}

const STORAGE_KEY = "letmetellu_recent_channels";
const MAX_RECENT_CHANNELS = 20;

export function getRecentChannels(): RecentChannel[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RecentChannel =>
        item
        && typeof item.id === "string"
        && typeof item.name === "string"
        && typeof item.lastVisitedAt === "number"
      )
      .sort((left, right) => right.lastVisitedAt - left.lastVisitedAt)
      .slice(0, MAX_RECENT_CHANNELS);
  } catch {
    return [];
  }
}

export function recordRecentChannel(channel: Omit<RecentChannel, "lastVisitedAt">) {
  if (typeof window === "undefined") return;
  try {
    const next = [
      { ...channel, lastVisitedAt: Date.now() },
      ...getRecentChannels().filter((item) => item.id !== channel.id),
    ].slice(0, MAX_RECENT_CHANNELS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Recent history is optional and must never prevent channel entry.
  }
}

export function removeRecentChannel(channelId: string) {
  if (typeof window === "undefined") return;
  try {
    const next = getRecentChannels().filter((item) => item.id !== channelId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep the dashboard usable when browser storage is unavailable.
  }
}

export function clearRecentChannels() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Keep the dashboard usable when browser storage is unavailable.
  }
}
