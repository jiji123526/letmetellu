export type WebPushSupport =
  | "supported"
  | "unsupported"
  | "blocked"
  | "ios-install-required"
  | "ios-update-required";

interface StoredPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function serializeSubscription(subscription: PushSubscription): StoredPushSubscription {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error("invalid_push_subscription");
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh, auth },
  };
}

async function readVapidPublicKey(): Promise<string> {
  const response = await fetch("/api/notifications/vapid-key", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as { publicKey?: unknown } | null;
  if (!response.ok || typeof body?.publicKey !== "string") throw new Error("push_not_configured");
  return body.publicKey;
}

export function getWebPushSupport(): WebPushSupport {
  if (typeof window === "undefined") return "unsupported";

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  const isTouchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || isTouchMac;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || navigatorWithStandalone.standalone === true;
  const versionMatch = isIos ? navigator.userAgent.match(/OS (\d+)[._](\d+)/) : null;

  if (versionMatch) {
    const major = Number(versionMatch[1]);
    const minor = Number(versionMatch[2]);
    if (major < 16 || (major === 16 && minor < 4)) return "ios-update-required";
  }

  if (isIos && !isStandalone) {
    return "ios-install-required";
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission === "denied" ? "blocked" : "supported";
}

export interface RegisteredPushSubscription {
  subscription: StoredPushSubscription;
  subscriptionId: string;
}

export async function subscribeCurrentBrowserToPush(deviceLabel?: string): Promise<RegisteredPushSubscription> {
  if (getWebPushSupport() === "unsupported") throw new Error("push_unsupported");
  if (Notification.permission === "denied") throw new Error("push_permission_blocked");

  // This function must be called only from an explicit user action. Importing
  // this module never registers a worker or opens the browser permission UI.
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("push_permission_not_granted");

  const [registration, publicKey] = await Promise.all([
    navigator.serviceWorker.register("/push-sw.js", { scope: "/" }),
    readVapidPublicKey(),
  ]);
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(publicKey),
  });
  const serialized = serializeSubscription(subscription);
  const response = await fetch("/api/notifications/subscriptions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...serialized,
      device_label: deviceLabel?.trim() || null,
    }),
  });
  const responseBody = await response.json().catch(() => null) as { subscriptionId?: unknown } | null;
  if (!response.ok || typeof responseBody?.subscriptionId !== "string") {
    throw new Error(`push_subscription_registration_failed:${response.status}`);
  }
  return { subscription: serialized, subscriptionId: responseBody.subscriptionId };
}

export async function sendPushSelfTest(subscriptionId: string, locale: "ko" | "en"): Promise<void> {
  const response = await fetch("/api/notifications/test", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription_id: subscriptionId, locale }),
  });
  if (!response.ok) throw new Error(`push_self_test_failed:${response.status}`);
}
