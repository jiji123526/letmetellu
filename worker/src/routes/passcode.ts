import { hashRateLimitIdentifier } from "../lib/durable-rate-limit.ts";
import { invalidatePasscodeCache } from "../lib/validation.ts";
import type { Env } from "../types.ts";

const PASSCODE_HASH_PREFIX = "pbkdf2-sha256$";
const PASSCODE_PBKDF2_ITERATIONS = 100_000;
const LEGACY_PASSCODE_HASH_PATTERN = /^[a-f0-9]{64}$/i;
type InternalSecretUsage = "sign" | "verify";
const PASSCODE_VERIFY_LIMIT = 5;
const PASSCODE_VERIFY_WINDOW_MS = 60_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return fromBase64(padded);
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function importInternalSecretKey(env: Env, usage: InternalSecretUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.INTERNAL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function derivePasscodeBits(passcode: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function createPasscodeHash(passcode: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePasscodeBits(passcode, salt, PASSCODE_PBKDF2_ITERATIONS);
  return `${PASSCODE_HASH_PREFIX}${PASSCODE_PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

async function verifyStoredPasscode(
  passcode: string,
  storedHash: string,
): Promise<{ verified: boolean; needsUpgrade: boolean }> {
  if (storedHash.startsWith(PASSCODE_HASH_PREFIX)) {
    const [, iterationsText, saltText, hashText] = storedHash.split("$");
    const iterations = Number(iterationsText);
    if (!Number.isInteger(iterations) || iterations < PASSCODE_PBKDF2_ITERATIONS || !saltText || !hashText) {
      return { verified: false, needsUpgrade: false };
    }
    try {
      const actual = await derivePasscodeBits(passcode, fromBase64(saltText), iterations);
      return {
        verified: timingSafeEqual(actual, fromBase64(hashText)),
        needsUpgrade: false,
      };
    } catch {
      return { verified: false, needsUpgrade: false };
    }
  }

  if (!LEGACY_PASSCODE_HASH_PATTERN.test(storedHash)) {
    return { verified: false, needsUpgrade: false };
  }

  const actual = await sha256Hex(passcode);
  return {
    verified: timingSafeEqual(
      new TextEncoder().encode(actual),
      new TextEncoder().encode(storedHash.toLowerCase()),
    ),
    needsUpgrade: true,
  };
}

async function createRoomTokenBinding(
  channelId: string,
  storedPasscodeHash: string,
  env: Env,
): Promise<string> {
  const key = await importInternalSecretKey(env, "sign");
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`room-access:${channelId}:${storedPasscodeHash}`))
  );
  return toBase64Url(signature);
}

function getPasscodeRequestIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Client-IP")
    || "unknown";
}

export function invalidatePasscodeAttempts(channelId: string) {
  void channelId;
}

export interface RoomTokenPayload {
  channel_id: string;
  passcode_binding: string;
  type: "room-access";
  version: 2;
  iat: number;
  exp: number;
}

export async function createRoomToken(
  channel_id: string,
  storedPasscodeHash: string,
  env: Env,
): Promise<string> {
  const encoder = new TextEncoder();
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadObj = {
    channel_id,
    passcode_binding: await createRoomTokenBinding(channel_id, storedPasscodeHash, env),
    type: "room-access",
    version: 2,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  };
  const payload = toBase64Url(JSON.stringify(payloadObj));

  const key = await importInternalSecretKey(env, "sign");
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${payload}`));
  const signature = toBase64Url(new Uint8Array(sig));

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

  // Get channel's stored passcode hash
  const channel = await env.DB.prepare("SELECT passcode FROM channels WHERE id = ?")
    .bind(channel_id).first() as { passcode: string | null } | null;

  if (!channel) {
    return Response.json({ error: "channel not found" }, { status: 404 });
  }

  // Only existing channels receive a Durable Object rate-limit record. This
  // prevents arbitrary channel IDs from being used to create unbounded objects.
  const rateLimitSubject = await hashRateLimitIdentifier(
    "passcode-verify",
    `${channel_id}:${getPasscodeRequestIp(request)}`,
    env,
  );
  const passcodeDoId = env.CHAT_ROOM.idFromName(channel_id);
  const passcodeStub = env.CHAT_ROOM.get(passcodeDoId);
  const rateLimitResponse = await passcodeStub.fetch(new Request("http://internal/channel-rate-limit", {
    method: "POST",
    body: JSON.stringify({
      scope: "passcode-verify",
      subjectKey: rateLimitSubject,
      limit: PASSCODE_VERIFY_LIMIT,
      windowMs: PASSCODE_VERIFY_WINDOW_MS,
    }),
  }));
  if (!rateLimitResponse.ok) {
    return Response.json({ error: "rate_limit_unavailable" }, { status: 503 });
  }
  const rateLimit = await rateLimitResponse.json() as { ok: boolean };
  if (!rateLimit.ok) {
    return Response.json({ error: "too_many_attempts" }, { status: 429 });
  }

  if (!channel.passcode) {
    return Response.json({ error: "no passcode set" }, { status: 400 });
  }

  const verification = await verifyStoredPasscode(passcode, channel.passcode);
  if (!verification.verified) {
    return Response.json({ error: "wrong_passcode" }, { status: 403 });
  }

  let currentStoredHash = channel.passcode;

  // Upgrade legacy raw SHA-256 passcodes to a salted PBKDF2 hash the first
  // time they are successfully used. This invalidates old room tokens once.
  if (verification.needsUpgrade) {
    const upgradedHash = await createPasscodeHash(passcode);
    const upgradeResult = await env.DB.prepare(
      "UPDATE channels SET passcode = ? WHERE id = ? AND passcode = ?"
    ).bind(upgradedHash, channel_id, channel.passcode).run();

    if (upgradeResult.meta.changes) {
      currentStoredHash = upgradedHash;
      invalidatePasscodeCache(channel_id);
      await passcodeStub.fetch(new Request("http://internal/access-policy-changed", {
        method: "POST",
        body: JSON.stringify({ passcode: upgradedHash }),
      })).catch((error) => {
        console.error("Legacy passcode upgrade broadcast failed", channel_id, error);
      });
    } else {
      const latest = await env.DB.prepare("SELECT passcode FROM channels WHERE id = ?")
        .bind(channel_id)
        .first<{ passcode: string | null }>();
      if (!latest?.passcode) {
        return Response.json({ error: "channel not found" }, { status: 404 });
      }
      const latestVerification = await verifyStoredPasscode(passcode, latest.passcode);
      if (!latestVerification.verified) {
        return Response.json({ error: "wrong_passcode" }, { status: 403 });
      }
      currentStoredHash = latest.passcode;
    }
  }

  const token = await createRoomToken(channel_id, currentStoredHash, env);

  return Response.json({ token });
}

// Verify a room token — returns the decoded payload or null
export async function verifyRoomToken(token: string, env: Env): Promise<RoomTokenPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;

    // Verify signature
    const encoder = new TextEncoder();
    const key = await importInternalSecretKey(env, "verify");

    const sigBytes = fromBase64Url(signature);
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(`${header}.${payload}`));
    if (!valid) return null;

    // Decode payload
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as RoomTokenPayload;

    // Check expiry
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;
    if (
      decoded.type !== "room-access"
      || decoded.version !== 2
      || typeof decoded.channel_id !== "string"
      || typeof decoded.passcode_binding !== "string"
      || !decoded.passcode_binding
    ) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

export async function authorizeRoomToken(
  token: string,
  channelId: string,
  storedPasscodeHash: string,
  env: Env,
): Promise<RoomTokenPayload | null> {
  const payload = await verifyRoomToken(token, env);
  if (!payload || payload.channel_id !== channelId) return null;

  const expectedBinding = await createRoomTokenBinding(channelId, storedPasscodeHash, env);
  return timingSafeEqual(
    new TextEncoder().encode(payload.passcode_binding),
    new TextEncoder().encode(expectedBinding),
  )
    ? payload
    : null;
}
