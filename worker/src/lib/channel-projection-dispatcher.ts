import type { Env } from "../types.ts";
import {
  drainChannelProjectionEvents,
  type ChannelProjectionDrainResult,
} from "./channel-projection-consumer.ts";
import { drainDomainEventRetention } from "./domain-event-retention.ts";

type CanaryShardId = "canary-a" | "canary-b";

export interface CanaryProjectionSource {
  shardId: CanaryShardId;
  database: D1Database;
}

export interface CanaryProjectionDispatchResult {
  enabled: boolean;
  shards: Array<{
    shardId: CanaryShardId;
    result: ChannelProjectionDrainResult;
  }>;
}

const BINDINGS: Record<
  CanaryShardId,
  keyof Pick<Env, "CHAT_DB_CANARY_A" | "CHAT_DB_CANARY_B">
> = {
  "canary-a": "CHAT_DB_CANARY_A",
  "canary-b": "CHAT_DB_CANARY_B",
};

export function isCanaryProjectionDispatchEnabled(env: Env): boolean {
  return env.D1_CANARY_PROJECTION_DISPATCH_ENABLED === "true";
}

export function resolveCanaryProjectionSources(env: Env): CanaryProjectionSource[] {
  if (!isCanaryProjectionDispatchEnabled(env)) return [];

  const configured = (env.D1_CANARY_PROJECTION_DISPATCH_SHARDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.length === 0) {
    throw new Error("canary_projection_shards_missing");
  }
  if (new Set(configured).size !== configured.length) {
    throw new Error("canary_projection_shards_duplicate");
  }

  const sources = configured.map((shardId): CanaryProjectionSource => {
    if (shardId !== "canary-a" && shardId !== "canary-b") {
      throw new Error("canary_projection_shard_unknown");
    }
    const database = env[BINDINGS[shardId]];
    if (!database) throw new Error("canary_projection_binding_missing");
    if (database === env.DB) throw new Error("canary_projection_binding_is_control");
    return { shardId, database };
  });
  if (new Set(sources.map((source) => source.database)).size !== sources.length) {
    throw new Error("canary_projection_bindings_alias");
  }
  return sources;
}

export async function dispatchCanaryChannelProjectionEvents(
  env: Env,
): Promise<CanaryProjectionDispatchResult> {
  const sources = resolveCanaryProjectionSources(env);
  const shards: CanaryProjectionDispatchResult["shards"] = [];
  for (const source of sources) {
    shards.push({
      shardId: source.shardId,
      result: await drainChannelProjectionEvents({
        sourceDatabase: source.database,
        controlDatabase: env.DB,
      }),
    });
  }
  return { enabled: sources.length > 0, shards };
}

export async function retainCanaryDomainEvents(
  env: Env,
): Promise<Array<{
  shardId: CanaryShardId;
  deliveredDeleted: number;
  deadDeleted: number;
}>> {
  const sources = resolveCanaryProjectionSources(env);
  const results = [];
  for (const source of sources) {
    results.push({
      shardId: source.shardId,
      ...await drainDomainEventRetention(source.database),
    });
  }
  return results;
}
