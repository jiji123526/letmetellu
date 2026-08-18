import type { Env } from "../types.ts";

interface UnifiedTimelineRolloutContext {
  live?: boolean;
  reports?: boolean;
}

export type UnifiedTimelineRolloutMode = "off" | "global" | "allowlist" | "sample";

export interface UnifiedTimelineRolloutDecision {
  enabled: boolean;
  mode: UnifiedTimelineRolloutMode;
  bucket: number | null;
}

const ROLLOUT_BUCKET_COUNT = 10_000;

function allowlistIncludes(allowlist: string | undefined, channelId: string): boolean {
  if (!allowlist) return false;
  return allowlist
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(channelId);
}

function parseSamplePercent(value: string | undefined): number {
  if (!value || !/^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)$/.test(value.trim())) {
    return 0;
  }
  const percent = Number(value);
  return Number.isFinite(percent) && percent > 0 && percent <= 100
    ? percent
    : 0;
}

export function getUnifiedTimelineRolloutBucket(
  channelId: string,
  salt: string,
): number {
  let hash = 0x811c9dc5;
  const input = `${salt}:${channelId}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % ROLLOUT_BUCKET_COUNT;
}

export function resolveUnifiedTimelineRollout(
  env: Env,
  channelId: string,
  context: UnifiedTimelineRolloutContext = {},
): UnifiedTimelineRolloutDecision {
  if (env.UNIFIED_TIMELINE_GLOBAL_ENABLED === "1") {
    return { enabled: true, mode: "global", bucket: null };
  }
  const specialChannel = context.live || context.reports;
  const allowlist = context.reports
    ? env.UNIFIED_TIMELINE_REPORTS_CHANNEL_ALLOWLIST
    : context.live
    ? env.UNIFIED_TIMELINE_LIVE_CHANNEL_ALLOWLIST
    : env.UNIFIED_TIMELINE_CHANNEL_ALLOWLIST;
  if (allowlistIncludes(allowlist, channelId)) {
    return { enabled: true, mode: "allowlist", bucket: null };
  }
  if (specialChannel) {
    return { enabled: false, mode: "off", bucket: null };
  }

  const percent = parseSamplePercent(env.UNIFIED_TIMELINE_SAMPLE_PERCENT);
  const salt = env.UNIFIED_TIMELINE_SAMPLE_SALT?.trim() || "";
  if (percent === 0 || !salt) {
    return { enabled: false, mode: "off", bucket: null };
  }
  const bucket = getUnifiedTimelineRolloutBucket(channelId, salt);
  return {
    enabled: bucket < Math.floor(percent * 100),
    mode: bucket < Math.floor(percent * 100) ? "sample" : "off",
    bucket,
  };
}

export function isUnifiedTimelineClientEnabled(
  env: Env,
  channelId: string,
  context: UnifiedTimelineRolloutContext = {},
): boolean {
  return resolveUnifiedTimelineRollout(env, channelId, context).enabled;
}
