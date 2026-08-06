export interface PublicChannelPreview {
  id: string;
  name: string;
  profileImage: string | null;
  bubbleColor: string;
  hasPasscode: boolean;
}

interface PublicChannelRow {
  id?: unknown;
  name?: unknown;
  profile_image?: unknown;
  bubble_color?: unknown;
  has_passcode?: unknown;
}

const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;

function workerOrigin(): URL {
  return new URL(process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787");
}

function resolvePublicProfileImage(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;

  try {
    const workerUrl = workerOrigin();
    const imageUrl = new URL(value, workerUrl);
    if (imageUrl.origin !== workerUrl.origin || !imageUrl.pathname.startsWith("/api/media/")) {
      return null;
    }
    imageUrl.search = "";
    imageUrl.hash = "";
    return imageUrl.toString();
  } catch {
    return null;
  }
}

export async function getPublicChannelPreview(channelId: string): Promise<PublicChannelPreview | null> {
  if (!CHANNEL_ID_PATTERN.test(channelId)) return null;

  try {
    const endpoint = new URL("/api/user", workerOrigin());
    endpoint.searchParams.set("exists", channelId);
    const response = await fetch(endpoint, { next: { revalidate: 300 } });
    if (!response.ok) return null;

    const data = await response.json() as { channels?: PublicChannelRow[] };
    const channel = data.channels?.find((row) => row.id === channelId);
    if (!channel) return null;

    const name = typeof channel.name === "string" && channel.name.trim()
      ? channel.name.trim().slice(0, 80)
      : channelId;
    const bubbleColor = typeof channel.bubble_color === "string" && /^#[0-9a-f]{6}$/i.test(channel.bubble_color)
      ? channel.bubble_color
      : "#3598fe";

    return {
      id: channelId,
      name,
      profileImage: resolvePublicProfileImage(channel.profile_image),
      bubbleColor,
      hasPasscode: channel.has_passcode === true || channel.has_passcode === 1,
    };
  } catch {
    return null;
  }
}

export function channelPreviewVersion(channel: PublicChannelPreview): string {
  const source = `${channel.profileImage || "none"}|${channel.name}|${channel.bubbleColor}|${channel.hasPasscode ? 1 : 0}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
