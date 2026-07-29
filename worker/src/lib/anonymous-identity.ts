import { Env } from "../types";

const ANONYMOUS_IDENTITY_TTL_SECONDS = 365 * 24 * 60 * 60;
const DEVICE_IDENTITY_TTL_SECONDS = 365 * 24 * 60 * 60;

interface BaseIdentityPayload {
  iat: number;
  exp: number;
}

export interface AnonymousIdentityPayload extends BaseIdentityPayload {
  type: "anonymous-identity";
  uid: string;
}

export interface DeviceIdentityPayload extends BaseIdentityPayload {
  type: "device-identity";
  device_id: string;
}

function base64UrlEncode(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

export async function createAnonymousIdentity(
  env: Env,
  uid = crypto.randomUUID(),
): Promise<{ uid: string; token: string }> {
  const payload: AnonymousIdentityPayload = {
    type: "anonymous-identity",
    uid,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ANONYMOUS_IDENTITY_TTL_SECONDS,
  };
  const token = await createIdentityToken(payload, env);
  return { uid, token };
}

export async function createDeviceIdentity(
  env: Env,
  deviceId = crypto.randomUUID(),
): Promise<{ deviceId: string; token: string }> {
  const payload: DeviceIdentityPayload = {
    type: "device-identity",
    device_id: deviceId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + DEVICE_IDENTITY_TTL_SECONDS,
  };
  const token = await createIdentityToken(payload, env);
  return { deviceId, token };
}

async function createIdentityToken(
  payload: AnonymousIdentityPayload | DeviceIdentityPayload,
  env: Env,
): Promise<string> {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.INTERNAL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload))
  );
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

export async function verifyAnonymousIdentityToken(
  token: string,
  env: Env,
): Promise<AnonymousIdentityPayload | null> {
  const payload = await verifyIdentityToken(token, env);
  if (!payload || payload.type !== "anonymous-identity" || typeof payload.uid !== "string" || !payload.uid) {
    return null;
  }
  return payload;
}

export async function verifyDeviceIdentityToken(
  token: string,
  env: Env,
): Promise<DeviceIdentityPayload | null> {
  const payload = await verifyIdentityToken(token, env);
  if (!payload || payload.type !== "device-identity" || typeof payload.device_id !== "string" || !payload.device_id) {
    return null;
  }
  return payload;
}

async function verifyIdentityToken(
  token: string,
  env: Env,
): Promise<AnonymousIdentityPayload | DeviceIdentityPayload | null> {
  try {
    const [encodedPayload, encodedSignature] = token.split(".");
    if (!encodedPayload || !encodedSignature) return null;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.INTERNAL_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signatureBytes = Uint8Array.from(base64UrlDecode(encodedSignature), (char) => char.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(encodedPayload),
    );
    if (!valid) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AnonymousIdentityPayload | DeviceIdentityPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
