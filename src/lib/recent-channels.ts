export interface RecentChannel {
  id: string;
  name: string;
  profileImage: string | null;
  bubbleColor: string;
  hasPasscode: boolean;
  ownerName: string;
  ownerUid?: string;
  pinned: boolean;
  lastVisitedAt: number;
}

const STORAGE_KEY = "letmetellu_recent_channels";
const VALIDATION_STORAGE_KEY = "letmetellu_recent_channels_validation";
const RECENT_CHANNEL_VALIDATION_TTL_MS = 5 * 60 * 1000;

function buildRecentChannelValidationSignature(channels: Pick<RecentChannel, "id">[]): string {
  return channels.map((channel) => channel.id).sort().join(",");
}

function readRecentChannelValidationState(): { signature: string; checkedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(VALIDATION_STORAGE_KEY) || "null");
    if (
      !parsed
      || typeof parsed.signature !== "string"
      || typeof parsed.checkedAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

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
      .map((item) => ({
        ...item,
        bubbleColor: typeof item.bubbleColor === "string" && item.bubbleColor ? item.bubbleColor : "#3b8df0",
        hasPasscode: item.hasPasscode === true,
        ownerName: typeof item.ownerName === "string" ? item.ownerName : "",
        pinned: item.pinned === true,
      }))
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.lastVisitedAt - left.lastVisitedAt);
  } catch {
    return [];
  }
}

export function recordRecentChannel(channel: Omit<RecentChannel, "lastVisitedAt" | "pinned">) {
  if (typeof window === "undefined") return;
  try {
    const existing = getRecentChannels().find((item) => item.id === channel.id);
    const next = [
      { ...channel, pinned: existing?.pinned ?? false, lastVisitedAt: Date.now() },
      ...getRecentChannels().filter((item) => item.id !== channel.id),
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Recent history is optional and must never prevent channel entry.
  }
}

export function updateRecentChannelAppearance(
  channelId: string,
  changes: Partial<Pick<RecentChannel, "name" | "profileImage" | "bubbleColor" | "hasPasscode">>,
) {
  if (typeof window === "undefined") return;
  try {
    const channels = getRecentChannels();
    if (!channels.some((item) => item.id === channelId)) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(channels.map((item) => item.id === channelId ? { ...item, ...changes } : item)),
    );
  } catch {
    // Recent history is optional and must never prevent channel updates.
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

export function toggleRecentChannelPinned(channelId: string) {
  if (typeof window === "undefined") return;
  try {
    const next = getRecentChannels().map((item) =>
      item.id === channelId ? { ...item, pinned: !item.pinned } : item
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep the dashboard usable when browser storage is unavailable.
  }
}

export function clearRecentChannels() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(VALIDATION_STORAGE_KEY);
  } catch {
    // Keep the dashboard usable when browser storage is unavailable.
  }
}

export function shouldValidateRecentChannels(channels: RecentChannel[]): boolean {
  if (channels.length === 0) return false;
  const cached = readRecentChannelValidationState();
  const signature = buildRecentChannelValidationSignature(channels);
  if (!cached) return true;
  if (cached.signature !== signature) return true;
  return Date.now() - cached.checkedAt >= RECENT_CHANNEL_VALIDATION_TTL_MS;
}

export function markRecentChannelsValidated(channels: RecentChannel[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VALIDATION_STORAGE_KEY, JSON.stringify({
      signature: buildRecentChannelValidationSignature(channels),
      checkedAt: Date.now(),
    }));
  } catch {
    // Recent history is optional and must never prevent channel entry.
  }
}
