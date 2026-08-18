import type { Env } from "../types.ts";

export function isUnifiedTimelineClientEnabled(
  env: Env,
  channelId: string,
  context: { live?: boolean; reports?: boolean } = {},
): boolean {
  if (context.live || context.reports) return false;
  const allowlist = env.UNIFIED_TIMELINE_CHANNEL_ALLOWLIST;
  if (!allowlist) return false;
  return allowlist
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(channelId);
}
