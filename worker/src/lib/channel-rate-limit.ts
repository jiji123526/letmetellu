export interface ChannelRateLimitBucket {
  windowStartMs: number;
  count: number;
}

export function advanceChannelRateLimit(
  previous: ChannelRateLimitBucket | null,
  nowMs: number,
  windowMs: number,
  limit: number,
): ChannelRateLimitBucket & { ok: boolean; resetAt: string } {
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  const count = previous?.windowStartMs === windowStartMs ? previous.count + 1 : 1;
  return {
    windowStartMs,
    count,
    ok: count <= limit,
    resetAt: new Date(windowStartMs + windowMs).toISOString(),
  };
}
