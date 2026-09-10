const TWITTER_HOSTS = new Set(["twitter.com", "www.twitter.com", "x.com", "www.x.com"]);

export function extractTwitterStatusId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!TWITTER_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.pathname.match(/\/status\/(\d+)(?:\/|$)/)?.[1] || null;
  } catch {
    return null;
  }
}

export function isFxTwitterMosaicUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === "mosaic.fxtwitter.com";
  } catch {
    return false;
  }
}

function validatedTwitterImageUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) return "";
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.hostname.toLowerCase() !== "pbs.twimg.com"
      || url.username
      || url.password
    ) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function selectFxTwitterMediaPreviewUrl(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const tweet = (payload as { tweet?: unknown }).tweet;
  if (!tweet || typeof tweet !== "object") return "";
  const media = (tweet as { media?: unknown }).media;
  if (!media || typeof media !== "object") return "";

  const photos = (media as { photos?: unknown }).photos;
  if (Array.isArray(photos)) {
    for (const photo of photos.slice(0, 4)) {
      if (!photo || typeof photo !== "object") continue;
      const url = validatedTwitterImageUrl((photo as { url?: unknown }).url);
      if (url) return url;
    }
  }

  const videos = (media as { videos?: unknown }).videos;
  if (Array.isArray(videos)) {
    for (const video of videos.slice(0, 4)) {
      if (!video || typeof video !== "object") continue;
      const url = validatedTwitterImageUrl(
        (video as { thumbnail_url?: unknown }).thumbnail_url,
      );
      if (url) return url;
    }
  }

  return "";
}
