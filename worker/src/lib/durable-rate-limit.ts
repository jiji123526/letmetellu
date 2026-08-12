import type { Env } from "../types.ts";

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function getRateLimitBucketStart(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

export async function hashRateLimitIdentifier(namespace: string, value: string, env: Env): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.INTERNAL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${namespace}:${value}`))
  );
  return base64UrlEncode(signature);
}

export async function consumeDurableRateLimit(input: {
  env: Env;
  scope: string;
  subjectKey: string;
  limit: number;
  windowMs: number;
  nowMs?: number;
}): Promise<{ ok: boolean; count: number; resetAt: string }> {
  const nowMs = input.nowMs ?? Date.now();
  const bucketStart = getRateLimitBucketStart(nowMs, input.windowMs);
  const updatedAt = new Date(nowMs).toISOString();

  await input.env.DB.prepare(`
    INSERT INTO durable_rate_limits (scope, subject_key, window_start_ms, count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(scope, subject_key, window_start_ms) DO UPDATE SET
      count = durable_rate_limits.count + 1,
      updated_at = excluded.updated_at
  `).bind(
    input.scope,
    input.subjectKey,
    bucketStart,
    updatedAt,
  ).run();

  const row = await input.env.DB.prepare(`
    SELECT count
    FROM durable_rate_limits
    WHERE scope = ? AND subject_key = ? AND window_start_ms = ?
    LIMIT 1
  `).bind(input.scope, input.subjectKey, bucketStart).first<{ count: number }>();

  return {
    ok: (row?.count || 0) <= input.limit,
    count: Number(row?.count || 0),
    resetAt: new Date(bucketStart + input.windowMs).toISOString(),
  };
}
