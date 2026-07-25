import { Env } from "../types";

export interface AdminWsTokenPayload {
  type: "admin-ws";
  channel_id: string;
  user_id: string;
  exp: number;
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export async function verifyAdminWsToken(token: string, env: Env): Promise<AdminWsTokenPayload | null> {
  try {
    const [payloadPart, signaturePart, extra] = token.split(".");
    if (!payloadPart || !signaturePart || extra) return null;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.INTERNAL_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(signaturePart),
      encoder.encode(payloadPart),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart))) as AdminWsTokenPayload;
    if (
      payload.type !== "admin-ws"
      || !payload.channel_id
      || !payload.user_id
      || payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
