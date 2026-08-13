export function getMediaCacheControl(
  sourceType: string | null | undefined,
  requiresPrivateCache: boolean,
): string {
  if (sourceType === "channel-profile") {
    return "public, max-age=31536000, immutable";
  }
  if (sourceType === "channel-background") {
    return requiresPrivateCache
      ? "private, max-age=300, must-revalidate"
      : "public, max-age=300, s-maxage=3600, must-revalidate";
  }
  if (sourceType === "message" || sourceType === "gallery" || sourceType === "dm") {
    return "private, max-age=300, must-revalidate";
  }
  if (sourceType) {
    return "private, no-store";
  }
  return "public, max-age=31536000, immutable";
}
