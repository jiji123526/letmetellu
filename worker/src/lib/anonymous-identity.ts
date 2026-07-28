import { Env } from "../types";

const ANONYMOUS_IDENTITY_TTL_SECONDS = 365 * 24 * 60 * 60;

interface AnonymousIdentityPayload {
  type: "anonymous-identity";
  uid: string;
  iat: number;
  exp: number;
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
  return {
    uid,
    token: `${encodedPayload}.${base64UrlEncode(signature)}`,
  };
}

export async function verifyAnonymousIdentityToken(
  token: string,
  env: Env,
): Promise<AnonymousIdentityPayload | null> {
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

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AnonymousIdentityPayload;
    if (payload.type !== "anonymous-identity" || typeof payload.uid !== "string" || !payload.uid) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
