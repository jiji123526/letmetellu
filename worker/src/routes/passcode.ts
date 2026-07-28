import { Env } from "../types";

async function hashPasscode(passcode: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(passcode);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Rate limit: 5 attempts per 60 seconds per channel
const passcodeAttempts = new Map<string, number[]>();

export function invalidatePasscodeAttempts(channelId: string) {
  passcodeAttempts.delete(channelId);
}

export async function createRoomToken(
  channel_id: string,
  passcode_hash: string,
  env: Env,
): Promise<string> {
  const encoder = new TextEncoder();
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payloadObj = {
    channel_id,
    passcode_hash,
    type: "room-access",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  };
  const payload = btoa(JSON.stringify(payloadObj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(env.INTERNAL_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${payload}`));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  return `${header}.${payload}.${signature}`;
}

export async function handleVerifyPasscode(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const body = await request.json() as { channel_id: string; passcode: string };
  const { channel_id, passcode } = body;

  if (!channel_id || !passcode) {
    return Response.json({ error: "missing fields" }, { status: 400 });
  }

  // Rate limit check
  const now = Date.now();
  const attempts = passcodeAttempts.get(channel_id) || [];
  const recent = attempts.filter((t) => now - t < 60000);
  if (recent.length >= 5) {
    return Response.json({ error: "too_many_attempts" }, { status: 429 });
  }
  recent.push(now);
  passcodeAttempts.set(channel_id, recent);

  // Get channel's stored passcode hash
  const channel = await env.DB.prepare("SELECT passcode FROM channels WHERE id = ?")
    .bind(channel_id).first() as { passcode: string | null } | null;

  if (!channel) {
    return Response.json({ error: "channel not found" }, { status: 404 });
  }

  if (!channel.passcode) {
    return Response.json({ error: "no passcode set" }, { status: 400 });
  }

  // Hash the submitted passcode and compare
  const hashedInput = await hashPasscode(passcode);
  if (hashedInput !== channel.passcode) {
    return Response.json({ error: "wrong_passcode" }, { status: 403 });
  }

  const token = await createRoomToken(channel_id, channel.passcode, env);

  return Response.json({ token });
}

// Verify a room token — returns the decoded payload or null
export async function verifyRoomToken(token: string, env: Env): Promise<{ channel_id: string; passcode_hash: string; exp: number } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;

    // Verify signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(env.INTERNAL_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );

    // Decode signature from base64url
    const sigBytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(`${header}.${payload}`));
    if (!valid) return null;

    // Decode payload
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));

    // Check expiry
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;

    return decoded;
  } catch {
    return null;
  }
}
