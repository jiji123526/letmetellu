import assert from "node:assert/strict";
import test from "node:test";
import {
  getControlDatabase,
  PRIMARY_DATABASE_SHARD_ID,
  resolveChannelDatabase,
} from "../src/lib/database-access.ts";
import type { Env } from "../src/types.ts";

function createEnv(): Env {
  return {
    DB: { prepare() {}, batch() {} },
  } as unknown as Env;
}

test("control data uses the existing primary database", () => {
  const env = createEnv();
  assert.equal(getControlDatabase(env), env.DB);
});

test("channel resolution preserves the single-database deployment", async () => {
  const env = createEnv();
  const resolved = await resolveChannelDatabase(env, "general");

  assert.equal(resolved.partitionKey, "general");
  assert.equal(resolved.shardId, PRIMARY_DATABASE_SHARD_ID);
  assert.equal(resolved.database, env.DB);
});

test("normal and live channel variants resolve to the same partition", async () => {
  const env = createEnv();
  const normal = await resolveChannelDatabase(env, "general");
  const live = await resolveChannelDatabase(env, "general_live");

  assert.equal(normal.partitionKey, live.partitionKey);
  assert.equal(normal.shardId, live.shardId);
  assert.equal(normal.database, live.database);
});
