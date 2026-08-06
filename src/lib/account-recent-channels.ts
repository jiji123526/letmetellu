import { decorateMediaUrl } from "./api-core";
import { normalizeBubbleColor } from "./bubble-color";
import type { RecentChannel } from "./recent-channels";

interface AccountRecentRow {
  id: string;
  name: string;
  profile_image: string | null;
  bubble_color: string | null;
  personal_bubble_color: string | null;
  has_passcode: number;
  owner_name: string | null;
  owner_uid: string;
  pinned: number;
  last_visited_at: number;
}

const ACCOUNT_RECENT_CACHE_PREFIX = "letmetellu_account_recent_channels_v1_";
const ACCOUNT_RECENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_RECENT_CACHE_LIMIT = 100;

export function readCachedAccountRecentChannels(userId: string): RecentChannel[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(`${ACCOUNT_RECENT_CACHE_PREFIX}${userId}`) || "null",
    ) as { cachedAt?: unknown; channels?: unknown } | null;
    if (
      typeof parsed?.cachedAt !== "number"
      || Date.now() - parsed.cachedAt > ACCOUNT_RECENT_CACHE_TTL_MS
      || !Array.isArray(parsed.channels)
    ) {
      return [];
    }
    return parsed.channels
      .filter((channel): channel is RecentChannel =>
        channel
        && typeof channel.id === "string"
        && typeof channel.name === "string"
        && typeof channel.bubbleColor === "string"
        && typeof channel.lastVisitedAt === "number"
      )
      .slice(0, ACCOUNT_RECENT_CACHE_LIMIT);
  } catch {
    return [];
  }
}

export function storeCachedAccountRecentChannels(userId: string, channels: RecentChannel[]) {
  if (typeof window === "undefined" || !userId) return;
  try {
    localStorage.setItem(
      `${ACCOUNT_RECENT_CACHE_PREFIX}${userId}`,
      JSON.stringify({
        cachedAt: Date.now(),
        channels: channels.slice(0, ACCOUNT_RECENT_CACHE_LIMIT),
      }),
    );
  } catch {
    // Dashboard snapshots are optional.
  }
}

export async function fetchAccountRecentChannels(): Promise<RecentChannel[]> {
  const response = await fetch("/api/recent-channels", { cache: "no-store" });
  if (!response.ok) throw new Error("recent channels unavailable");
  const data = await response.json() as { channels?: AccountRecentRow[] };
  return (data.channels || []).map((channel) => ({
    id: channel.id,
    name: channel.name,
    profileImage: decorateMediaUrl(channel.profile_image),
    bubbleColor: normalizeBubbleColor(channel.personal_bubble_color || channel.bubble_color),
    hasPasscode: channel.has_passcode === 1,
    ownerName: channel.owner_name || "",
    ownerUid: channel.owner_uid,
    pinned: channel.pinned === 1,
    lastVisitedAt: channel.last_visited_at,
  }));
}

async function postAccountRecent(payload: Record<string, unknown>) {
  const response = await fetch("/api/recent-channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("recent channel update failed");
  return response.json() as Promise<{ record?: { bubble_color?: string | null } }>;
}

export async function mergeAccountRecentChannels(channels: RecentChannel[]) {
  for (let index = 0; index < channels.length; index += 20) {
    await postAccountRecent({ action: "merge", channels: channels.slice(index, index + 20) });
  }
}

export const recordAccountRecentChannel = (channelId: string) =>
  postAccountRecent({ action: "visit", channel_id: channelId });

export const setAccountRecentChannelPinned = (channelId: string, pinned: boolean) =>
  postAccountRecent({ action: "pin", channel_id: channelId, pinned });

export const setAccountChannelColor = (channelId: string, bubbleColor: string) =>
  postAccountRecent({ action: "color", channel_id: channelId, bubble_color: bubbleColor });

export async function removeAccountRecentChannel(channelId: string) {
  const response = await fetch(`/api/recent-channels?channel=${encodeURIComponent(channelId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("recent channel delete failed");
}
