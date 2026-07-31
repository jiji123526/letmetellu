const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
const MEDIA_ACCESS_TTL_SECONDS = 15 * 60;

function encodeBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString("base64url");
}

async function signPayload(payload: string): Promise<string> {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) throw new Error("INTERNAL_SECRET is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return encodeBase64Url(signature);
}

async function createMediaAccessToken(mediaKey: string): Promise<string> {
  const payload = encodeBase64Url(JSON.stringify({
    type: "media-access",
    key: mediaKey,
    exp: Math.floor(Date.now() / 1000) + MEDIA_ACCESS_TTL_SECONDS,
  }));
  const signature = await signPayload(payload);
  return `${payload}.${signature}`;
}

function extractMediaKey(mediaUrl: string): string | null {
  try {
    const parsed = new URL(mediaUrl, WORKER_URL);
    if (!parsed.pathname.startsWith("/api/media/")) return null;
    return decodeURIComponent(parsed.pathname.replace(/^\/api\/media\//, ""));
  } catch {
    return null;
  }
}

async function signMediaUrl(mediaUrl: string): Promise<string> {
  const mediaKey = extractMediaKey(mediaUrl);
  if (!mediaKey) return mediaUrl;
  const token = await createMediaAccessToken(mediaKey);
  const direct = new URL(`/api/media/${mediaKey.split("/").map(encodeURIComponent).join("/")}`, WORKER_URL);
  direct.searchParams.set("media_token", token);
  return direct.toString();
}

async function signObjectMedia<T extends Record<string, unknown>>(value: T): Promise<T> {
  let changed = false;
  const next: Record<string, unknown> = { ...value };

  if (typeof value.image === "string") {
    next.image = await signMediaUrl(value.image);
    changed ||= next.image !== value.image;
  }
  if (typeof value.background_image === "string") {
    next.background_image = await signMediaUrl(value.background_image);
    changed ||= next.background_image !== value.background_image;
  }

  return changed ? next as T : value;
}

export async function signProtectedMediaInPayload<T>(payload: T): Promise<T> {
  if (!payload || typeof payload !== "object") return payload;
  const target = payload as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = { ...target };

  if (target.channel && typeof target.channel === "object" && target.channel !== null) {
    const signedChannel = await signObjectMedia(target.channel as Record<string, unknown>);
    next.channel = signedChannel;
    changed ||= signedChannel !== target.channel;
  }

  for (const key of ["messages", "dm", "results", "gallery"] as const) {
    const collection = target[key];
    if (!Array.isArray(collection)) continue;
    const signedCollection = await Promise.all(collection.map(async (item) => {
      if (!item || typeof item !== "object") return item;
      return signObjectMedia(item as Record<string, unknown>);
    }));
    next[key] = signedCollection;
    changed = true;
  }

  return changed ? next as T : payload;
}
