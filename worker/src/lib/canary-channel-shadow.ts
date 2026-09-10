import type { Env } from "../types.ts";
import { recordOperationalEvent } from "./operational-events.ts";
import {
  type CanaryShardId,
  resolveCanaryProjectionSource,
} from "./channel-projection-dispatcher.ts";
import { getParentChannelId, isReportsChannel } from "./special-channels.ts";

const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;
const MAX_SHADOW_CHANNELS = 20;
const EVENT_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_EVENT_COOLDOWN_KEYS = 100;

interface CanaryChannelRow {
  id: string;
  owner_uid: string;
  passcode: string | null;
  is_frozen: number | null;
  instance_id: string | null;
  show_on_profile: number | null;
  projection_source_version: number;
}

export interface CanaryChannelShadowPlacement {
  channelId: string;
  shardId: CanaryShardId;
}

export type CanaryChannelShadowMismatch =
  | "missing_control"
  | "missing_canary"
  | "owner_mismatch"
  | "access_state_mismatch"
  | "instance_mismatch"
  | "visibility_mismatch"
  | "projection_version_mismatch";

export interface CanaryChannelShadowComparison {
  matches: boolean;
  mismatches: CanaryChannelShadowMismatch[];
}

const lastEventAt = new Map<string, number>();
let lastInvalidConfiguration: string | null = null;

export function parseCanaryChannelShadowAllowlist(
  value: string | undefined,
): CanaryChannelShadowPlacement[] | null {
  const configured = value?.trim();
  if (!configured) return [];

  const entries = configured.split(",").map((entry) => entry.trim());
  if (
    entries.length > MAX_SHADOW_CHANNELS
    || entries.some((entry) => entry.length === 0)
  ) {
    return null;
  }

  const placements: CanaryChannelShadowPlacement[] = [];
  const seenChannels = new Set<string>();
  for (const entry of entries) {
    const parts = entry.split(":");
    if (parts.length !== 2) return null;
    const [shardId, channelId] = parts;
    if (
      (shardId !== "canary-a" && shardId !== "canary-b")
      || !CHANNEL_ID_PATTERN.test(channelId)
      || seenChannels.has(channelId)
    ) {
      return null;
    }
    seenChannels.add(channelId);
    placements.push({ shardId, channelId });
  }
  return placements;
}

export function resolveCanaryChannelShadowPlacement(
  env: Env,
  requestedChannelId: string | null,
): CanaryChannelShadowPlacement | null {
  if (!requestedChannelId) return null;
  const parentChannelId = getParentChannelId(requestedChannelId);
  const placements = parseCanaryChannelShadowAllowlist(
    env.D1_CANARY_SHADOW_CHANNELS,
  );
  if (placements === null) {
    const configuration = env.D1_CANARY_SHADOW_CHANNELS || "";
    if (configuration !== lastInvalidConfiguration) {
      console.warn("canary channel shadow disabled: invalid configuration");
      lastInvalidConfiguration = configuration;
    }
    return null;
  }
  if (isReportsChannel(parentChannelId, env)) return null;
  return placements.find((placement) => placement.channelId === parentChannelId)
    || null;
}

function readCanaryChannelRow(
  database: D1Database,
  channelId: string,
): Promise<CanaryChannelRow | null> {
  return database.prepare(`
    SELECT
      id,
      owner_uid,
      passcode,
      is_frozen,
      instance_id,
      show_on_profile,
      projection_source_version
    FROM channels
    WHERE id = ?
  `).bind(channelId).first<CanaryChannelRow>();
}

export async function compareCanaryChannelShadow(
  env: Env,
  placement: CanaryChannelShadowPlacement,
): Promise<CanaryChannelShadowComparison> {
  const canary = resolveCanaryProjectionSource(env, placement.shardId);
  const [controlRow, canaryRow] = await Promise.all([
    readCanaryChannelRow(env.DB, placement.channelId),
    readCanaryChannelRow(canary.database, placement.channelId),
  ]);

  if (!controlRow) {
    return { matches: false, mismatches: ["missing_control"] };
  }
  if (!canaryRow) {
    return { matches: false, mismatches: ["missing_canary"] };
  }

  const mismatches: CanaryChannelShadowMismatch[] = [];
  if (
    controlRow.id !== canaryRow.id
    || controlRow.owner_uid !== canaryRow.owner_uid
  ) {
    mismatches.push("owner_mismatch");
  }
  if (
    controlRow.passcode !== canaryRow.passcode
    || Number(controlRow.is_frozen || 0) !== Number(canaryRow.is_frozen || 0)
  ) {
    mismatches.push("access_state_mismatch");
  }
  if (controlRow.instance_id !== canaryRow.instance_id) {
    mismatches.push("instance_mismatch");
  }
  if (
    Number(controlRow.show_on_profile || 0)
    !== Number(canaryRow.show_on_profile || 0)
  ) {
    mismatches.push("visibility_mismatch");
  }
  if (
    Number(controlRow.projection_source_version)
    !== Number(canaryRow.projection_source_version)
  ) {
    mismatches.push("projection_version_mismatch");
  }
  return { matches: mismatches.length === 0, mismatches };
}

function shouldRecordEvent(key: string, now = Date.now()): boolean {
  const previous = lastEventAt.get(key);
  if (previous !== undefined && now - previous < EVENT_COOLDOWN_MS) return false;
  if (!lastEventAt.has(key) && lastEventAt.size >= MAX_EVENT_COOLDOWN_KEYS) {
    for (const [existingKey, recordedAt] of lastEventAt) {
      if (now - recordedAt >= EVENT_COOLDOWN_MS) lastEventAt.delete(existingKey);
    }
    if (lastEventAt.size >= MAX_EVENT_COOLDOWN_KEYS) {
      const oldestKey = lastEventAt.keys().next().value;
      if (oldestKey !== undefined) lastEventAt.delete(oldestKey);
    }
  }
  lastEventAt.set(key, now);
  return true;
}

export async function observeCanaryChannelShadow(
  env: Env,
  placement: CanaryChannelShadowPlacement,
): Promise<void> {
  try {
    const comparison = await compareCanaryChannelShadow(env, placement);
    if (comparison.matches) return;
    const signature = comparison.mismatches.join(",");
    if (!shouldRecordEvent(`mismatch:${placement.channelId}:${signature}`)) return;
    await recordOperationalEvent({
      env,
      severity: "warn",
      route: "GET /api/init",
      eventType: "canary_channel_shadow_mismatch",
      statusCode: 200,
      targetId: placement.channelId,
      detail: {
        shard_id: placement.shardId,
        reasons: comparison.mismatches,
      },
    });
  } catch {
    if (!shouldRecordEvent(`failed:${placement.channelId}`)) return;
    await recordOperationalEvent({
      env,
      severity: "warn",
      route: "GET /api/init",
      eventType: "canary_channel_shadow_failed",
      statusCode: 200,
      targetId: placement.channelId,
      detail: {
        shard_id: placement.shardId,
        error_code: "canary_channel_shadow_read_failed",
      },
    });
  }
}
