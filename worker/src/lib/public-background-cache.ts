const PUBLIC_BACKGROUND_CACHE_VERSION = 1;

export function canUsePublicBackgroundCache(request: Request): boolean {
  const url = new URL(request.url);
  return request.method === "GET" && url.search === "";
}

export function createPublicBackgroundCacheKey(request: Request, mediaKey: string): Request {
  const url = new URL(`/__public_background_cache/v${PUBLIC_BACKGROUND_CACHE_VERSION}`, request.url);
  url.searchParams.set("key", mediaKey);
  return new Request(url.toString(), { method: "GET" });
}

export async function readPublicBackgroundCache(
  request: Request,
  mediaKey: string,
): Promise<Response | null> {
  if (!canUsePublicBackgroundCache(request)) return null;
  try {
    return await caches.default.match(createPublicBackgroundCacheKey(request, mediaKey)) ?? null;
  } catch {
    return null;
  }
}

export async function storePublicBackgroundCache(
  request: Request,
  mediaKey: string,
  response: Response,
): Promise<void> {
  if (!canUsePublicBackgroundCache(request)) return;
  try {
    await caches.default.put(
      createPublicBackgroundCacheKey(request, mediaKey),
      response.clone(),
    );
  } catch (error) {
    console.warn("failed to cache public channel background", error);
  }
}
