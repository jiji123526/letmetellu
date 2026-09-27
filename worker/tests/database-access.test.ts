import assert from "node:assert/strict";
import test from "node:test";
import {
  getChannelDatabaseCacheScope,
  getChannelDatabaseMaintenanceScopes,
  getControlDatabase,
  PRIMARY_DATABASE_PLACEMENT_VERSION,
  PRIMARY_DATABASE_SHARD_ID,
  resolveChannelDatabase,
  withDatabase,
} from "../src/lib/database-access.ts";
import type { Env } from "../src/types.ts";

function createEnv(): Env {
  return {
    DB: { prepare() {}, batch() {} },
  } as unknown as Env;
}

function createCanaryEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...createEnv(),
    CHAT_DB_CANARY_A: { prepare() {}, batch() {} } as unknown as D1Database,
    D1_CHANNEL_PLACEMENTS: "canary-a:zziks",
    D1_CHANNEL_PLACEMENT_VERSION: "2",
    ...overrides,
  } as Env;
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
  assert.equal(resolved.placementVersion, PRIMARY_DATABASE_PLACEMENT_VERSION);
  assert.equal(
    getChannelDatabaseCacheScope(resolved),
    `${PRIMARY_DATABASE_SHARD_ID}:${PRIMARY_DATABASE_PLACEMENT_VERSION}`,
  );
  assert.equal(resolved.database, env.DB);
});

test("normal and live channel variants resolve to the same partition", async () => {
  const env = createEnv();
  const normal = await resolveChannelDatabase(env, "general");
  const live = await resolveChannelDatabase(env, "general_live");

  assert.equal(normal.partitionKey, live.partitionKey);
  assert.equal(normal.shardId, live.shardId);
  assert.equal(normal.placementVersion, live.placementVersion);
  assert.equal(normal.database, live.database);
});

test("an explicit static placement routes only its parent and live channel", async () => {
  const env = createCanaryEnv();
  const normal = await resolveChannelDatabase(env, "zziks");
  const live = await resolveChannelDatabase(env, "zziks_live");
  const unrelated = await resolveChannelDatabase(env, "general");

  assert.equal(normal.database, env.CHAT_DB_CANARY_A);
  assert.equal(normal.shardId, "canary-a");
  assert.equal(normal.placementVersion, 2);
  assert.deepEqual(
    { partitionKey: live.partitionKey, shardId: live.shardId, version: live.placementVersion },
    { partitionKey: "zziks", shardId: "canary-a", version: 2 },
  );
  assert.equal(unrelated.database, env.DB);
  assert.equal(unrelated.placementVersion, PRIMARY_DATABASE_PLACEMENT_VERSION);
});

test("maintenance scopes assign each configured channel to exactly one database", () => {
  const env = createCanaryEnv({
    CHAT_DB_CANARY_B: { prepare() {}, batch() {} } as unknown as D1Database,
    D1_CHANNEL_PLACEMENTS: "canary-a:zziks,canary-b:second",
  });
  const scopes = getChannelDatabaseMaintenanceScopes(env);

  assert.equal(scopes.length, 3);
  assert.deepEqual(scopes[0], {
    shardId: PRIMARY_DATABASE_SHARD_ID,
    database: env.DB,
    includeChannelIds: [],
    excludeChannelIds: ["zziks", "second"],
  });
  assert.deepEqual(scopes[1], {
    shardId: "canary-a",
    database: env.CHAT_DB_CANARY_A,
    includeChannelIds: ["zziks"],
    excludeChannelIds: [],
  });
  assert.deepEqual(scopes[2], {
    shardId: "canary-b",
    database: env.CHAT_DB_CANARY_B,
    includeChannelIds: ["second"],
    excludeChannelIds: [],
  });
});

test("static placement configuration fails closed instead of falling back", async () => {
  const cases: Array<[Partial<Env>, RegExp]> = [
    [{ D1_CHANNEL_PLACEMENT_VERSION: undefined }, /configuration_incomplete/],
    [{ D1_CHANNEL_PLACEMENTS: undefined }, /configuration_incomplete/],
    [{ D1_CHANNEL_PLACEMENT_VERSION: "1" }, /version_invalid/],
    [{ D1_CHANNEL_PLACEMENTS: "unknown:zziks" }, /entry_invalid/],
    [{ D1_CHANNEL_PLACEMENTS: "canary-a:zziks_live" }, /entry_invalid/],
    [{ D1_CHANNEL_PLACEMENTS: "canary-a:reports" }, /entry_invalid/],
    [{ D1_CHANNEL_PLACEMENTS: "canary-a:zziks,canary-b:zziks" }, /channel_duplicate/],
    [{ CHAT_DB_CANARY_A: undefined }, /binding_missing/],
  ];
  for (const [overrides, expected] of cases) {
    await assert.rejects(
      resolveChannelDatabase(createCanaryEnv(overrides), "zziks"),
      expected,
    );
  }

  const aliasEnv = createCanaryEnv();
  aliasEnv.CHAT_DB_CANARY_A = aliasEnv.DB;
  await assert.rejects(
    resolveChannelDatabase(aliasEnv, "zziks"),
    /binding_is_control/,
  );
});

test("database-scoped environments preserve non-database bindings", () => {
  const env = createEnv();
  const database = { prepare() {}, batch() {} } as unknown as D1Database;
  const scoped = withDatabase(env, database);

  assert.notEqual(scoped, env);
  assert.equal(scoped.DB, database);
  assert.equal(scoped.MEDIA, env.MEDIA);
  assert.equal(withDatabase(env, env.DB), env);
});
