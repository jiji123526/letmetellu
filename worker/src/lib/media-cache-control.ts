export function getMediaCacheControl(
  sourceType: string | null | undefined,
  channelHasPasscode: boolean,
): string {
  if (sourceType === "channel-profile") {
    return "public, max-age=31536000, immutable";
  }
  if (sourceType === "channel-background") {
    return channelHasPasscode
      ? "private, max-age=900, must-revalidate"
      : "private, max-age=604800, immutable";
  }
  if (sourceType) {
    return "private, no-store";
  }
  return "public, max-age=31536000, immutable";
}
