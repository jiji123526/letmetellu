import { getParentChannelId } from "./special-channels.ts";
import type { Env } from "../types.ts";
import {
  resolveCanaryProjectionSource,
  type CanaryShardId,
} from "./channel-projection-dispatcher.ts";

export const PRIMARY_DATABASE_SHARD_ID = "primary";
export const PRIMARY_DATABASE_PLACEMENT_VERSION = 1;
const MAX_STATIC_PLACEMENTS = 20;
const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;

interface StaticChannelPlacement {
  shardId: CanaryShardId;
  channelId: string;
}

export interface ResolvedChannelDatabase {
  partitionKey: string;
  shardId: string;
  placementVersion: number;
  database: D1Database;
}

export function getControlDatabase(env: Env): D1Database {
  return env.DB;
}

export function withDatabase(env: Env, database: D1Database): Env {
  if (database === env.DB) return env;
  return { ...env, DB: database };
}

export function getChannelDatabaseCacheScope(
  resolved: Pick<ResolvedChannelDatabase, "shardId" | "placementVersion">,
): string {
  return `${resolved.shardId}:${resolved.placementVersion}`;
}

function parseStaticChannelPlacements(env: Env): {
  placements: StaticChannelPlacement[];
  version: number;
} | null {
  const configuration = env.D1_CHANNEL_PLACEMENTS?.trim() || "";
  const versionText = env.D1_CHANNEL_PLACEMENT_VERSION?.trim() || "";
  if (!configuration && !versionText) return null;
  if (!configuration || !versionText) {
    throw new Error("channel_placement_configuration_incomplete");
  }
  const version = Number(versionText);
  if (
    !Number.isSafeInteger(version)
    || version <= PRIMARY_DATABASE_PLACEMENT_VERSION
  ) {
    throw new Error("channel_placement_version_invalid");
  }
  const reportsChannelId = getParentChannelId(env.REPORTS_CHANNEL_ID || "reports");
  const entries = configuration.split(",").map((entry) => entry.trim());
  if (
    entries.length === 0
    || entries.length > MAX_STATIC_PLACEMENTS
    || entries.some((entry) => !entry)
  ) {
    throw new Error("channel_placement_configuration_invalid");
  }
  const placements = entries.map((entry): StaticChannelPlacement => {
    const [shardId, channelId, ...rest] = entry.split(":");
    if (
      rest.length > 0
      || (shardId !== "canary-a" && shardId !== "canary-b")
      || !CHANNEL_ID_PATTERN.test(channelId || "")
      || channelId === reportsChannelId
      || getParentChannelId(channelId) !== channelId
    ) {
      throw new Error("channel_placement_entry_invalid");
    }
    return { shardId, channelId };
  });
  if (new Set(placements.map((placement) => placement.channelId)).size !== placements.length) {
    throw new Error("channel_placement_channel_duplicate");
  }
  for (const shardId of new Set(placements.map((placement) => placement.shardId))) {
    resolveCanaryProjectionSource(env, shardId);
  }
  return { placements, version };
}

/**
 * Centralize channel placement before introducing physical shards. Keeping this
 * async allows a future implementation to consult a cached channel directory
 * without changing every caller again.
 */
export async function resolveChannelDatabase(
  env: Env,
  channelId: string,
): Promise<ResolvedChannelDatabase> {
  const partitionKey = getParentChannelId(channelId);
  const configured = parseStaticChannelPlacements(env);
  const placement = configured?.placements.find((entry) => (
    entry.channelId === partitionKey
  ));
  if (placement && configured) {
    const source = resolveCanaryProjectionSource(env, placement.shardId);
    return {
      partitionKey,
      shardId: source.shardId,
      placementVersion: configured.version,
      database: source.database,
    };
  }
  return {
    partitionKey,
    shardId: PRIMARY_DATABASE_SHARD_ID,
    placementVersion: PRIMARY_DATABASE_PLACEMENT_VERSION,
    database: env.DB,
  };
}
