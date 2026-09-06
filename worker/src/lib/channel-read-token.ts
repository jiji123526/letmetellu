import { verifyAnonymousIdentityToken } from "./anonymous-identity.ts";
import { getTrustedUserId } from "./trusted-identity.ts";
import type { Env } from "../types.ts";

type ChannelReadViewer = "owner" | "visitor";

export interface ChannelReadSnapshot {
  id: string;
  owner_uid: string;
  name: string;
  profile_image: string | null;
  bubble_color: string | null;
  notice: string | null;
  is_frozen: number;
  created_at: string | null;
  passcode_hint: string | null;
  instance_id: string | null;
  show_on_profile: number;
  background_type: string | null;
  background_color: string | null;
  background_image: string | null;
  background_overlay: number;
  background_blur: number;
  owner_name: string | null;
  moderation_status: string | null;
  moderation_petition_status: string | null;
  owner_channel_count: number;
  has_passcode: boolean;
}

export interface ChannelReadTokenPayload {
  type: "channel-read";
  version: 1;
  channel_id: string;
  viewer: ChannelReadViewer;
  subject: string;
  channel: ChannelReadSnapshot;
  iat: number;
  exp: number;
}

const PUBLIC_READ_TTL_SECONDS = 2 * 60;
const SENSITIVE_READ_TTL_SECONDS = 30;

function toBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importSigningKey(env: Env, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.INTERNAL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function createChannelReadToken(input: {
  channelId: string;
  viewer: ChannelReadViewer;
  subject: string;
  sensitive: boolean;
  channel: ChannelReadSnapshot;
  env: Env;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify({
    type: "channel-read",
    version: 1,
    channel_id: input.channelId,
    viewer: input.viewer,
    subject: input.subject,
    channel: input.channel,
    iat: now,
    exp: now + (input.sensitive ? SENSITIVE_READ_TTL_SECONDS : PUBLIC_READ_TTL_SECONDS),
  } satisfies ChannelReadTokenPayload));
  const key = await importSigningKey(input.env, "sign");
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifyChannelReadToken(
  token: string,
  env: Env,
): Promise<ChannelReadTokenPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const key = await importSigningKey(env, "verify");
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    if (!valid) return null;
    const decoded = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payload)),
    ) as ChannelReadTokenPayload;
    const now = Math.floor(Date.now() / 1000);
    if (
      decoded.type !== "channel-read"
      || decoded.version !== 1
      || (decoded.viewer !== "owner" && decoded.viewer !== "visitor")
      || typeof decoded.channel_id !== "string"
      || typeof decoded.subject !== "string"
      || !decoded.subject
      || !decoded.channel
      || decoded.channel.id !== decoded.channel_id.replace(/_live$/, "")
      || typeof decoded.channel.owner_uid !== "string"
      || typeof decoded.channel.name !== "string"
      || typeof decoded.channel.has_passcode !== "boolean"
      || !Number.isFinite(decoded.iat)
      || !Number.isFinite(decoded.exp)
      || decoded.iat > now + 5
      || decoded.exp <= now
      || decoded.exp <= decoded.iat
      || decoded.exp - decoded.iat > PUBLIC_READ_TTL_SECONDS
      || decoded.exp > now + PUBLIC_READ_TTL_SECONDS
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export async function authorizeChannelReadToken(
  request: Request,
  channelId: string,
  env: Env,
): Promise<ChannelReadTokenPayload | null> {
  const token = request.headers.get("X-Channel-Read-Token") || "";
  if (!token) return null;
  const payload = await verifyChannelReadToken(token, env);
  if (!payload || payload.channel_id !== channelId) return null;

  if (payload.viewer === "owner") {
    return getTrustedUserId(request, env) === payload.subject ? payload : null;
  }

  const anonymousToken = request.headers.get("X-Anonymous-Token") || "";
  const identity = anonymousToken
    ? await verifyAnonymousIdentityToken(anonymousToken, env)
    : null;
  return identity?.uid === payload.subject ? payload : null;
}
