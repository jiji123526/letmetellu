import { normalizeBubbleColor } from "./bubble-color";
import { getChannelAppearanceVersion } from "./channel-appearance";

export interface ChannelBackgroundSnapshot {
  instanceId: string | null;
  type: "default" | "color" | "image";
  color: string | null;
  image: string | null;
  overlay: number;
  blur: boolean;
}

export interface ChannelAppearanceSnapshot extends ChannelBackgroundSnapshot {
  bubbleColor: string;
  appearanceVersion: string;
}

export interface ChannelAppearanceSource {
  instance_id?: string | null;
  bubble_color?: string | null;
  appearance_version?: string | null;
  background_type?: "default" | "color" | "image";
  background_color?: string | null;
  background_image?: string | null;
  background_overlay?: number;
  background_blur?: number;
}

const CACHE_VERSION = 2;
const CACHE_PREFIX = "channelBackground_";
const BACKGROUND_PREPARE_TIMEOUT_MS = 2_000;
const backgroundPreparationCache = new Map<string, Promise<boolean>>();

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

export async function prepareChannelBackground(
  source: ChannelAppearanceSource,
): Promise<void> {
  if (
    typeof window === "undefined"
    || typeof Image === "undefined"
    || source.background_type !== "image"
  ) {
    return;
  }
  const imageUrl = stableMediaUrl(source.background_image);
  if (!imageUrl) return;

  let preparation = backgroundPreparationCache.get(imageUrl);
  if (!preparation) {
    preparation = new Promise<boolean>((resolve) => {
      const image = new Image();
      let settled = false;
      let loadHandled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(ready);
      };
      const handleLoad = () => {
        if (loadHandled) return;
        loadHandled = true;
        const decoded = typeof image.decode === "function"
          ? image.decode().catch(() => {})
          : Promise.resolve();
        void decoded.then(() => finish(true));
      };
      const timeoutId = window.setTimeout(
        () => finish(false),
        BACKGROUND_PREPARE_TIMEOUT_MS,
      );
      image.onload = handleLoad;
      image.onerror = () => finish(false);
      image.src = imageUrl;
      if (image.complete && image.naturalWidth > 0) handleLoad();
    });
    backgroundPreparationCache.set(imageUrl, preparation);
    void preparation.then(() => {
      if (backgroundPreparationCache.get(imageUrl) === preparation) {
        backgroundPreparationCache.delete(imageUrl);
      }
    });
  }
  await preparation;
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

function isAppearanceSnapshot(value: unknown): value is ChannelAppearanceSnapshot {
  if (!isSnapshot(value)) return false;
  const appearance = value as Partial<ChannelAppearanceSnapshot>;
  return (
    typeof appearance.bubbleColor === "string"
    && /^#[0-9a-fA-F]{6}$/.test(appearance.bubbleColor)
    && typeof appearance.appearanceVersion === "string"
    && appearance.appearanceVersion.length > 0
  );
}

function toBackgroundSnapshot(
  appearance: ChannelAppearanceSnapshot | null,
): ChannelBackgroundSnapshot | null {
  if (!appearance) return null;
  const { instanceId, type, color, image, overlay, blur } = appearance;
  return { instanceId, type, color, image, overlay, blur };
}

export function readChannelAppearance(channelId: string): ChannelAppearanceSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(channelId)) || "null") as {
      version?: unknown;
      appearance?: unknown;
      background?: unknown;
    } | null;
    const cachedAppearance = parsed?.version === CACHE_VERSION && isAppearanceSnapshot(parsed.appearance)
      ? parsed.appearance
      : null;
    const cachedBackground = parsed?.version === 1 && isSnapshot(parsed.background)
      ? parsed.background
      : null;
    const appearance = cachedAppearance || (cachedBackground
      ? {
          ...cachedBackground,
          bubbleColor: normalizeBubbleColor(null),
          appearanceVersion: getChannelAppearanceVersion({
            background_type: cachedBackground.type,
            background_color: cachedBackground.color,
            background_image: cachedBackground.image,
            background_overlay: cachedBackground.overlay,
            background_blur: cachedBackground.blur ? 1 : 0,
          }),
        }
      : null);
    if (!appearance) return null;

    const knownInstance = localStorage.getItem(`channelInstance_${channelId}`);
    if (
      knownInstance
      && appearance.instanceId
      && knownInstance !== appearance.instanceId
    ) {
      localStorage.removeItem(cacheKey(channelId));
      return null;
    }
    return appearance;
  } catch {
    return null;
  }
}

export function readChannelBackground(channelId: string): ChannelBackgroundSnapshot | null {
  return toBackgroundSnapshot(readChannelAppearance(channelId));
}

export function storeChannelAppearance(channelId: string, source: ChannelAppearanceSource) {
  if (typeof window === "undefined") return;
  try {
    const appearance: ChannelAppearanceSnapshot = {
      instanceId: source.instance_id || localStorage.getItem(`channelInstance_${channelId}`),
      bubbleColor: normalizeBubbleColor(source.bubble_color),
      appearanceVersion: source.appearance_version || getChannelAppearanceVersion(source),
      type: source.background_type || "default",
      color: source.background_color || null,
      image: stableMediaUrl(source.background_image),
      overlay: Number.isInteger(source.background_overlay) ? source.background_overlay! : 14,
      blur: source.background_blur === 1,
    };
    localStorage.setItem(cacheKey(channelId), JSON.stringify({
      version: CACHE_VERSION,
      appearance,
    }));
  } catch {
    // Background restoration is optional.
  }
}

export function storeChannelBackground(channelId: string, source: ChannelAppearanceSource) {
  storeChannelAppearance(channelId, source);
}

export function patchChannelAppearance(channelId: string, update: ChannelAppearanceSource) {
  if (typeof window === "undefined") return;
  const current = readChannelAppearance(channelId);
  if (!current) return;
  const hasAppearanceUpdate = (
    update.bubble_color !== undefined
    || update.appearance_version !== undefined
    || update.background_type !== undefined
    || update.background_color !== undefined
    || update.background_image !== undefined
    || update.background_overlay !== undefined
    || update.background_blur !== undefined
  );
  if (!hasAppearanceUpdate) return;

  storeChannelAppearance(channelId, {
    instance_id: update.instance_id ?? current.instanceId,
    bubble_color: update.bubble_color ?? current.bubbleColor,
    appearance_version: update.appearance_version || getChannelAppearanceVersion({
      bubble_color: update.bubble_color ?? current.bubbleColor,
      background_type: update.background_type ?? current.type,
      background_color: update.background_color !== undefined ? update.background_color : current.color,
      background_image: update.background_image !== undefined ? update.background_image : current.image,
      background_overlay: update.background_overlay ?? current.overlay,
      background_blur: update.background_blur !== undefined
        ? update.background_blur
        : current.blur ? 1 : 0,
    }),
    background_type: update.background_type ?? current.type,
    background_color: update.background_color !== undefined ? update.background_color : current.color,
    background_image: update.background_image !== undefined ? update.background_image : current.image,
    background_overlay: update.background_overlay ?? current.overlay,
    background_blur: update.background_blur !== undefined
      ? update.background_blur
      : current.blur ? 1 : 0,
  });
}

export function patchChannelBackground(channelId: string, update: ChannelAppearanceSource) {
  patchChannelAppearance(channelId, update);
}

export function clearChannelBackground(channelId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(cacheKey(channelId));
  } catch {
    // Background restoration is optional.
  }
}
