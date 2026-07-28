import { Env } from "../types";

export function extractMediaKey(source: string | null | undefined): string | null {
  if (!source) return null;

  try {
    const url = new URL(source);
    if (!url.pathname.startsWith("/api/media/")) return null;
    return decodeURIComponent(url.pathname.replace(/^\/api\/media\//, ""));
  } catch {
    return source.startsWith("/api/media/")
      ? decodeURIComponent(source.replace(/^\/api\/media\//, ""))
      : null;
  }
}

export async function deleteMediaByUrl(env: Env, source: string | null | undefined): Promise<void> {
  const key = extractMediaKey(source);
  if (!key) return;
  await env.MEDIA.delete(key).catch(() => {});
}
