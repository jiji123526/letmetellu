const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
export const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === "true";

export type UploadPurpose = "message" | "dm" | "channel-asset";
export type UploadResult = { url: string; uploadId?: string };

export function getStoredUid(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("letsplay_uid");
}

export function notifyRoomAccessGranted(channelId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`roomToken_${channelId}`);
  window.dispatchEvent(new CustomEvent("room-token-changed", {
    detail: { channelId, hasAccess: true },
  }));
}

export function clearRoomToken(channelId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`roomToken_${channelId}`);
  void fetch(`/api/room-token?channel=${encodeURIComponent(channelId)}`, {
    method: "DELETE",
    cache: "no-store",
  }).catch(() => {});
  window.dispatchEvent(new CustomEvent("room-token-changed", {
    detail: { channelId, hasAccess: false },
  }));
}

export function setAnonymousIdentity(uid: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("letsplay_uid", uid);
  window.dispatchEvent(new CustomEvent("anonymous-identity-changed", {
    detail: { uid },
  }));
}

export function getParentChannelId(channelId: string): string {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

export function roomTokenHeaders(): Record<string, string> {
  return {};
}

function buildDirectMediaUrl(
  mediaUrl: string | null | undefined,
  options?: { keepSameOrigin?: boolean },
): string | null {
  if (!mediaUrl) return null;

  try {
    const parsed = new URL(mediaUrl, WORKER_URL);
    if (!parsed.pathname.startsWith("/api/media/")) return mediaUrl;
    if (parsed.searchParams.has("media_token")) {
      return parsed.toString();
    }

    if (options?.keepSameOrigin) {
      return `${parsed.pathname}${parsed.search}`;
    }

    const direct = new URL(parsed.pathname, WORKER_URL);
    parsed.searchParams.forEach((value, key) => {
      if (key !== "token") direct.searchParams.append(key, value);
    });

    return direct.toString();
  } catch {
    return mediaUrl;
  }
}

export function decorateMediaUrl(mediaUrl: string | null | undefined): string | null {
  return buildDirectMediaUrl(mediaUrl);
}

export function decorateProtectedMediaUrl(mediaUrl: string | null | undefined): string | null {
  return buildDirectMediaUrl(mediaUrl, { keepSameOrigin: true });
}

export function decorateBackgroundMediaUrl(mediaUrl: string | null | undefined): string | null {
  if (!mediaUrl) return null;

  try {
    const parsed = new URL(mediaUrl, WORKER_URL);
    if (!parsed.pathname.startsWith("/api/media/")) return mediaUrl;
    return parsed.pathname;
  } catch {
    return mediaUrl;
  }
}

export function decorateMessageMedia<T extends { image?: string | null }>(message: T): T {
  if (!message.image) return message;
  const image = decorateProtectedMediaUrl(message.image);
  return image === message.image ? message : { ...message, image };
}

export function decorateChannelMedia<T extends { profile_image?: string | null; background_image?: string | null }>(channel: T): T {
  const profile_image = decorateMediaUrl(channel.profile_image);
  const background_image = decorateBackgroundMediaUrl(channel.background_image);
  if (profile_image === channel.profile_image && background_image === channel.background_image) return channel;
  return { ...channel, profile_image, background_image };
}

export function decorateWelcomeConfig(config: string | undefined): string | undefined {
  if (!config) return config;
  try {
    const parsed = JSON.parse(config) as { icon?: unknown };
    if (typeof parsed.icon !== "string") return config;
    const icon = decorateProtectedMediaUrl(parsed.icon);
    if (!icon || icon === parsed.icon) return config;
    return JSON.stringify({ ...parsed, icon });
  } catch {
    return config;
  }
}

export function getWorkerUrl() {
  return WORKER_URL;
}
