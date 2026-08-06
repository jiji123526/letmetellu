export function getMediaCacheControl(
  sourceType: string | null | undefined,
  requiresPrivateCache: boolean,
): string {
  if (sourceType === "channel-profile") {
    return "public, max-age=31536000, immutable";
  }
  if (sourceType === "channel-background") {
    return requiresPrivateCache
      ? "private, max-age=900, must-revalidate"
      : "public, max-age=604800, s-maxage=3600, immutable";
  }
  if (sourceType) {
    return "private, no-store";
  }
  return "public, max-age=31536000, immutable";
}
