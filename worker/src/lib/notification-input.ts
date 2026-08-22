export const NOTIFICATION_BODY_LIMIT_BYTES = 8 * 1024;
export const MAX_ACTIVE_PUSH_SUBSCRIPTIONS = 5;

const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;
const PUSH_ENDPOINT_MAX_LENGTH = 2_048;
const PUSH_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const DEVICE_LABEL_MAX_LENGTH = 40;

export type NotificationMode = "off" | "important";

export interface NotificationPreferenceInput {
  channelId: string;
  mode: NotificationMode;
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
  deviceLabel: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isValidNotificationChannelId(value: unknown): value is string {
  return typeof value === "string" && CHANNEL_ID_PATTERN.test(value);
}

export function parseNotificationPreference(value: unknown): NotificationPreferenceInput | null {
  if (!isRecord(value) || !isValidNotificationChannelId(value.channel_id)) return null;
  if (value.mode !== "off" && value.mode !== "important") return null;
  return { channelId: value.channel_id, mode: value.mode };
}

export function parsePushSubscription(value: unknown): PushSubscriptionInput | null {
  if (!isRecord(value) || typeof value.endpoint !== "string") return null;
  if (!isRecord(value.keys)) return null;

  let endpoint: URL;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    return null;
  }
  if (endpoint.protocol !== "https:" || value.endpoint.length > PUSH_ENDPOINT_MAX_LENGTH) return null;

  const p256dh = value.keys.p256dh;
  const auth = value.keys.auth;
  if (typeof p256dh !== "string" || p256dh.length < 40 || p256dh.length > 256 || !PUSH_KEY_PATTERN.test(p256dh)) {
    return null;
  }
  if (typeof auth !== "string" || auth.length < 8 || auth.length > 128 || !PUSH_KEY_PATTERN.test(auth)) {
    return null;
  }

  const expirationTime = value.expirationTime == null ? null : Number(value.expirationTime);
  if (expirationTime !== null && (!Number.isSafeInteger(expirationTime) || expirationTime <= 0)) return null;

  const rawLabel = typeof value.device_label === "string" ? value.device_label.trim() : "";
  const deviceLabel = rawLabel ? rawLabel.slice(0, DEVICE_LABEL_MAX_LENGTH) : null;
  return {
    endpoint: value.endpoint,
    p256dh,
    auth,
    expirationTime,
    deviceLabel,
  };
}

export function normalizePushUserAgentFamily(userAgent: string | null): string {
  const value = (userAgent || "").toLowerCase();
  if (value.includes("edg/")) return "Edge";
  if (value.includes("firefox/")) return "Firefox";
  if (value.includes("chrome/") || value.includes("crios/")) return "Chrome";
  if (value.includes("safari/") || value.includes("applewebkit/")) return "Safari";
  return "Other";
}
