export interface ChannelBackgroundSnapshot {
  instanceId: string | null;
  type: "default" | "color" | "image";
  color: string | null;
  image: string | null;
  overlay: number;
  blur: boolean;
}

interface ChannelBackgroundSource {
  instance_id?: string | null;
  background_type?: "default" | "color" | "image";
  background_color?: string | null;
  background_image?: string | null;
  background_overlay?: number;
  background_blur?: number;
}

const CACHE_VERSION = 1;
const CACHE_PREFIX = "channelBackground_";

function cacheKey(channelId: string) {
  return `${CACHE_PREFIX}${channelId}`;
}

function stableMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.pathname.startsWith("/api/media/") ? parsed.pathname : null;
  } catch {
    return null;
  }
}

function isStableMediaUrl(value: unknown): value is string | null {
  return value === null || (
    typeof value === "string"
    && value.startsWith("/api/media/")
    && !/["'\\\s]/.test(value)
  );
}

function isSnapshot(value: unknown): value is ChannelBackgroundSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ChannelBackgroundSnapshot>;
  return (
    (snapshot.instanceId === null || typeof snapshot.instanceId === "string")
    && (snapshot.type === "default" || snapshot.type === "color" || snapshot.type === "image")
    && (snapshot.color === null || (
      typeof snapshot.color === "string"
      && /^#[0-9a-fA-F]{6}$/.test(snapshot.color)
    ))
    && isStableMediaUrl(snapshot.image)
    && typeof snapshot.overlay === "number"
    && Number.isInteger(snapshot.overlay)
    && snapshot.overlay >= 0
    && snapshot.overlay <= 60
    && typeof snapshot.blur === "boolean"
  );
}

export function readChannelBackground(channelId: string): ChannelBackgroundSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(channelId)) || "null") as {
      version?: unknown;
      background?: unknown;
    } | null;
    if (parsed?.version !== CACHE_VERSION || !isSnapshot(parsed.background)) return null;

    const knownInstance = localStorage.getItem(`channelInstance_${channelId}`);
    if (
      knownInstance
      && parsed.background.instanceId
      && knownInstance !== parsed.background.instanceId
    ) {
      localStorage.removeItem(cacheKey(channelId));
      return null;
    }
    return parsed.background;
  } catch {
    return null;
  }
}

export function storeChannelBackground(channelId: string, source: ChannelBackgroundSource) {
  if (typeof window === "undefined") return;
  try {
    const background: ChannelBackgroundSnapshot = {
      instanceId: source.instance_id || localStorage.getItem(`channelInstance_${channelId}`),
      type: source.background_type || "default",
      color: source.background_color || null,
      image: stableMediaUrl(source.background_image),
      overlay: Number.isInteger(source.background_overlay) ? source.background_overlay! : 14,
      blur: source.background_blur === 1,
    };
    localStorage.setItem(cacheKey(channelId), JSON.stringify({
      version: CACHE_VERSION,
      background,
    }));
  } catch {
    // Background restoration is optional.
  }
}

export function patchChannelBackground(channelId: string, update: ChannelBackgroundSource) {
  if (typeof window === "undefined") return;
  const current = readChannelBackground(channelId);
  if (!current) return;
  const hasBackgroundUpdate = (
    update.background_type !== undefined
    || update.background_color !== undefined
    || update.background_image !== undefined
    || update.background_overlay !== undefined
    || update.background_blur !== undefined
  );
  if (!hasBackgroundUpdate) return;

  storeChannelBackground(channelId, {
    instance_id: update.instance_id ?? current.instanceId,
    background_type: update.background_type ?? current.type,
    background_color: update.background_color !== undefined ? update.background_color : current.color,
    background_image: update.background_image !== undefined ? update.background_image : current.image,
    background_overlay: update.background_overlay ?? current.overlay,
    background_blur: update.background_blur !== undefined
      ? update.background_blur
      : current.blur ? 1 : 0,
  });
}

export function clearChannelBackground(channelId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(cacheKey(channelId));
  } catch {
    // Background restoration is optional.
  }
}
