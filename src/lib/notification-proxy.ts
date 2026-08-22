import { readRoomTokenCookie } from "@/lib/room-token-cookie";

export const NOTIFICATION_PROXY_BODY_LIMIT_BYTES = 8 * 1024;

export function isSameOriginNotificationMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function readBoundedNotificationBody(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > NOTIFICATION_PROXY_BODY_LIMIT_BYTES) return null;
  const body = await request.text();
  return new TextEncoder().encode(body).byteLength <= NOTIFICATION_PROXY_BODY_LIMIT_BYTES ? body : null;
}

export function notificationWorkerHeaders(request: Request, userId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Internal-Token": process.env.INTERNAL_SECRET || "",
    "X-User-Id": userId,
    "X-Client-User-Agent": request.headers.get("user-agent") || "",
  };
}

export function addNotificationRoomToken(
  headers: Record<string, string>,
  request: Request,
  channelId: string,
): void {
  const token = request.headers.get("X-Room-Token")
    || readRoomTokenCookie(request.headers.get("cookie"), channelId);
  if (token) headers["X-Room-Token"] = token;
}
