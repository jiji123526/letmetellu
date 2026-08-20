const MAX_MEDIA_DIMENSION = 10_000;

export type MediaDimensions =
  | { width: number; height: number }
  | null;

export function parseMediaDimensions(
  body: Record<string, unknown>,
): MediaDimensions | undefined {
  const width = body.image_w;
  const height = body.image_h;
  if (width === undefined && height === undefined) return null;
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || Number(width) < 1
    || Number(height) < 1
    || Number(width) > MAX_MEDIA_DIMENSION
    || Number(height) > MAX_MEDIA_DIMENSION
  ) return undefined;
  return { width: Number(width), height: Number(height) };
}
