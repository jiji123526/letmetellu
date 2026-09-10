import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isCanaryProjectionDispatchEnabled,
  resolveCanaryProjectionSources,
} from "../src/lib/channel-projection-dispatcher.ts";
import type { Env } from "../src/types.ts";

const indexSource = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);
const productionWrangler = readFileSync(
  new URL("../wrangler.toml", import.meta.url),
  "utf8",
);

function database(): D1Database {
  return { prepare() {}, batch() {} } as unknown as D1Database;
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: database(),
    ...overrides,
  } as unknown as Env;
}

test("canary projection dispatch is disabled by default without bindings", () => {
  const input = env();
  assert.equal(isCanaryProjectionDispatchEnabled(input), false);
  assert.deepEqual(resolveCanaryProjectionSources(input), []);
  assert.doesNotMatch(productionWrangler, /CHAT_DB_CANARY_|D1_CANARY_PROJECTION_/);
});

test("enabled dispatch fails closed on incomplete or unknown configuration", () => {
  assert.throws(
    () => resolveCanaryProjectionSources(env({
      D1_CANARY_PROJECTION_DISPATCH_ENABLED: "true",
    })),
    /canary_projection_shards_missing/,
  );
  assert.throws(
    () => resolveCanaryProjectionSources(env({
      D1_CANARY_PROJECTION_DISPATCH_ENABLED: "true",
      D1_CANARY_PROJECTION_DISPATCH_SHARDS: "canary-c",
    })),
    /canary_projection_shard_unknown/,
  );
  assert.throws(
    () => resolveCanaryProjectionSources(env({
      D1_CANARY_PROJECTION_DISPATCH_ENABLED: "true",
      D1_CANARY_PROJECTION_DISPATCH_SHARDS: "canary-a",
    })),
    /canary_projection_binding_missing/,
  );
});

test("enabled dispatch rejects control aliases and duplicate shard bindings", () => {
  const control = database();
  assert.throws(
    () => resolveCanaryProjectionSources(env({
      DB: control,
      CHAT_DB_CANARY_A: control,
      D1_CANARY_PROJECTION_DISPATCH_ENABLED: "true",
      D1_CANARY_PROJECTION_DISPATCH_SHARDS: "canary-a",
    })),
    /canary_projection_binding_is_control/,
  );

  const shared = database();
  assert.throws(
    () => resolveCanaryProjectionSources(env({
      CHAT_DB_CANARY_A: shared,
      CHAT_DB_CANARY_B: shared,
      D1_CANARY_PROJECTION_DISPATCH_ENABLED: "true",
      D1_CANARY_PROJECTION_DISPATCH_SHARDS: "canary-a,canary-b",
    })),
    /canary_projection_bindings_alias/,
  );
  assert.throws(
    () => resolveCanaryProjectionSources(env({
      CHAT_DB_CANARY_A: database(),
      D1_CANARY_PROJECTION_DISPATCH_ENABLED: "true",
      D1_CANARY_PROJECTION_DISPATCH_SHARDS: "canary-a,canary-a",
    })),
    /canary_projection_shards_duplicate/,
  );
});

test("valid bindings preserve explicit shard order", () => {
  const canaryA = database();
  const canaryB = database();
  const input = env({
    CHAT_DB_CANARY_A: canaryA,
    CHAT_DB_CANARY_B: canaryB,
    D1_CANARY_PROJECTION_DISPATCH_ENABLED: "true",
    D1_CANARY_PROJECTION_DISPATCH_SHARDS: "canary-b, canary-a",
  });

  assert.deepEqual(resolveCanaryProjectionSources(input), [
    { shardId: "canary-b", database: canaryB },
    { shardId: "canary-a", database: canaryA },
  ]);
});

test("cron calls projection work only behind the explicit enable gate", () => {
  assert.match(
    indexSource,
    /if \(isCanaryProjectionDispatchEnabled\(env\)\)[\s\S]*dispatchCanaryChannelProjectionEvents\(env\)/,
  );
  assert.match(
    indexSource,
    /if \(isCanaryProjectionDispatchEnabled\(env\)\)[\s\S]*retainCanaryDomainEvents\(env\)/,
  );
  assert.match(indexSource, /detail: \{ error: "canary_projection_dispatch_failed" \}/);
  assert.match(indexSource, /detail: \{ error: "canary_domain_event_retention_failed" \}/);
});
