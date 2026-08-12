import type { Env } from "../types.ts";

export type ActorRecordType = "message" | "dm";

const BLOCKED_DEVICE_HASH_CONTEXT = "blocked-device-v1";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function importHmacKey(env: Env, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.INTERNAL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function hashBlockedDeviceId(deviceId: string, env: Env): Promise<string> {
  const key = await importHmacKey(env, "sign");
  const payload = `${BLOCKED_DEVICE_HASH_CONTEXT}:${deviceId}`;
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  );
  return bytesToHex(digest);
}

export async function getBlockedDeviceLookup(deviceId: string | null, env: Env): Promise<{
  raw: string;
  hashed: string;
}> {
  if (!deviceId) {
    return { raw: "", hashed: "" };
  }
  return {
    raw: deviceId,
    hashed: await hashBlockedDeviceId(deviceId, env),
  };
}

export async function isBlockedActor(input: {
  env: Env;
  channelId: string;
  uid: string;
  deviceId: string | null;
}): Promise<boolean> {
  const { env, channelId, uid, deviceId } = input;
  const lookup = await getBlockedDeviceLookup(deviceId, env);
  const blocked = await env.DB.prepare(
    "SELECT 1 FROM blocked WHERE channel_id = ? AND (uid = ? OR device_id = ? OR device_id = ? OR fingerprint = ?) LIMIT 1"
  ).bind(channelId, uid, lookup.raw, lookup.hashed, lookup.raw).first();
  return Boolean(blocked);
}

export async function resolveActorIdentity(input: {
  env: Env;
  recordId: string;
  recordType: ActorRecordType;
  channelId: string;
}): Promise<{ uid: string; deviceIdHash: string } | null> {
  const { env, recordId, recordType, channelId } = input;
  const row = await env.DB.prepare(
    `SELECT uid, device_id_hash
     FROM message_actor_identities
     WHERE record_id = ? AND record_type = ? AND channel_id = ?
     LIMIT 1`
  ).bind(recordId, recordType, channelId).first<{ uid: string; device_id_hash: string }>();
  if (!row) return null;
  return {
    uid: row.uid,
    deviceIdHash: row.device_id_hash,
  };
}
