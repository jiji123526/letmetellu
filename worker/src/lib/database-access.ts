import { getParentChannelId } from "./special-channels.ts";
import type { Env } from "../types.ts";

export const PRIMARY_DATABASE_SHARD_ID = "primary";

export interface ResolvedChannelDatabase {
  partitionKey: string;
  shardId: string;
  database: D1Database;
}

export function getControlDatabase(env: Env): D1Database {
  return env.DB;
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
    database: env.DB,
  };
}
