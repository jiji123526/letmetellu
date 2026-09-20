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
      && url.hostname.toLowerCase() === "mosaic.fxtwitter.com"
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function firstFxTwitterMosaicPhotoUrl(
  rawUrl: string,
  expectedStatusId: string,
): string {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:"
      || url.hostname.toLowerCase() !== "mosaic.fxtwitter.com"
      || url.username
      || url.password
    ) {
      return "";
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const [format, statusId, firstMediaKey] = segments;
    if (
      !["jpeg", "webp"].includes(format)
      || statusId !== expectedStatusId
      || !/^\d+$/.test(statusId)
      || !/^[A-Za-z0-9_-]{8,128}$/.test(firstMediaKey || "")
    ) {
      return "";
    }

    const imageUrl = new URL(`https://pbs.twimg.com/media/${firstMediaKey}`);
    imageUrl.searchParams.set("format", "jpg");
    imageUrl.searchParams.set("name", "orig");
    return imageUrl.toString();
  } catch {
    return "";
  }
}
