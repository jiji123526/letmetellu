const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
const MEDIA_ACCESS_TTL_SECONDS = 15 * 60;

interface MediaAccessContext {
  roomToken?: string | null;
  userId?: string | null;
}

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

async function readRoomTokenBinding(roomToken: string | null | undefined, mediaKey: string): Promise<{
  channel_id: string;
  passcode_binding: string;
} | null> {
  if (!roomToken) return null;
  try {
    const [headerPart, payloadPart, signaturePart, extra] = roomToken.split(".");
    if (!headerPart || !payloadPart || !signaturePart || extra) return null;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(process.env.INTERNAL_SECRET || ""),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      Buffer.from(signaturePart, "base64url"),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
      type?: string;
      version?: number;
      channel_id?: string;
      passcode_binding?: string;
    };
    const mediaChannelId = mediaKey.split("/")[0]?.replace(/_live$/, "");
    if (
      payload.type !== "room-access"
      || payload.version !== 2
      || payload.channel_id !== mediaChannelId
      || typeof payload.passcode_binding !== "string"
    ) {
      return null;
    }
    return {
      channel_id: payload.channel_id,
      passcode_binding: payload.passcode_binding,
    };
  } catch {
    return null;
  }
}

async function createMediaAccessToken(
  mediaKey: string,
  context: MediaAccessContext,
): Promise<string> {
  const roomAccess = await readRoomTokenBinding(context.roomToken, mediaKey);
  const payload = encodeBase64Url(JSON.stringify({
    type: "media-access",
    key: mediaKey,
    ...(context.userId ? { user_id: context.userId } : {}),
    ...(roomAccess || {}),
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

async function signMediaUrl(mediaUrl: string, context: MediaAccessContext): Promise<string> {
  const mediaKey = extractMediaKey(mediaUrl);
  if (!mediaKey) return mediaUrl;
  const token = await createMediaAccessToken(mediaKey, context);
  const direct = new URL(`/api/media/${mediaKey.split("/").map(encodeURIComponent).join("/")}`, WORKER_URL);
  direct.searchParams.set("media_token", token);
  return direct.toString();
}

async function signObjectMedia<T extends Record<string, unknown>>(
  value: T,
  context: MediaAccessContext,
): Promise<T> {
  let changed = false;
  const next: Record<string, unknown> = { ...value };

  if (typeof value.image === "string") {
    next.image = await signMediaUrl(value.image, context);
    changed ||= next.image !== value.image;
  }
  if (typeof value.background_image === "string") {
    next.background_image = await signMediaUrl(value.background_image, context);
    changed ||= next.background_image !== value.background_image;
  }

  return changed ? next as T : value;
}

export async function signProtectedMediaInPayload<T>(
  payload: T,
  context: MediaAccessContext = {},
): Promise<T> {
  if (!payload || typeof payload !== "object") return payload;
  const target = payload as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = { ...target };

  if (target.channel && typeof target.channel === "object" && target.channel !== null) {
    const signedChannel = await signObjectMedia(target.channel as Record<string, unknown>, context);
    next.channel = signedChannel;
    changed ||= signedChannel !== target.channel;
  }

  for (const key of ["messages", "dm", "results", "gallery"] as const) {
    const collection = target[key];
    if (!Array.isArray(collection)) continue;
    const signedCollection = await Promise.all(collection.map(async (item) => {
      if (!item || typeof item !== "object") return item;
      return signObjectMedia(item as Record<string, unknown>, context);
    }));
    next[key] = signedCollection;
    changed = true;
  }

  return changed ? next as T : payload;
}
