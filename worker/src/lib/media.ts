import type { Env } from "../types.ts";

const MEDIA_PATH_PREFIX = "/api/media/";

export function extractMediaKey(source: string | null | undefined): string | null {
  if (!source) return null;

  try {
    const url = new URL(source, "http://local.media");
    if (!url.pathname.startsWith(MEDIA_PATH_PREFIX)) return null;
    return decodeURIComponent(url.pathname.replace(/^\/api\/media\//, ""));
  } catch {
    return null;
  }
}

export function buildManagedMediaPath(key: string): string {
  return `${MEDIA_PATH_PREFIX}${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function normalizeManagedMediaUrl(source: string | null | undefined): string | null {
  const key = extractMediaKey(source);
  return key ? buildManagedMediaPath(key) : null;
}

export async function deleteMediaByUrl(env: Env, source: string | null | undefined): Promise<void> {
  const key = extractMediaKey(source);
  if (!key) return;
  await env.MEDIA.delete(key).catch(() => {});
}
