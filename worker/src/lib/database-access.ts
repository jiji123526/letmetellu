import { getParentChannelId } from "./special-channels.ts";
import type { Env } from "../types.ts";

export const PRIMARY_DATABASE_SHARD_ID = "primary";
export const PRIMARY_DATABASE_PLACEMENT_VERSION = 1;

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

/**
 * Centralize channel placement before introducing physical shards. Keeping this
 * async allows a future implementation to consult a cached channel directory
 * without changing every caller again.
 */
export async function resolveChannelDatabase(
  env: Env,
  channelId: string,
): Promise<ResolvedChannelDatabase> {
  return {
    partitionKey: getParentChannelId(channelId),
    shardId: PRIMARY_DATABASE_SHARD_ID,
    placementVersion: PRIMARY_DATABASE_PLACEMENT_VERSION,
    database: env.DB,
  };
}
