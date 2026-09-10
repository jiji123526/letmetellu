import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  compareCanaryChannelShadow,
  parseCanaryChannelShadowAllowlist,
  resolveCanaryChannelShadowPlacement,
} from "../src/lib/canary-channel-shadow.ts";
import type { Env } from "../src/types.ts";

interface ChannelRow {
  id: string;
  owner_uid: string;
  passcode: string | null;
  is_frozen: number;
  instance_id: string | null;
  show_on_profile: number;
  projection_source_version: number;
}

class ShadowStatement {
  private readonly database: ShadowDatabase;
  readonly sql: string;
  private readonly values: unknown[];

  constructor(
    database: ShadowDatabase,
    sql: string,
    values: unknown[] = [],
  ) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new ShadowStatement(this.database, this.sql, values);
  }

  async first<T>() {
    this.database.queries.push({ sql: this.sql, values: this.values });
    return this.database.row as T | null;
  }
}

class ShadowDatabase {
  queries: Array<{ sql: string; values: unknown[] }> = [];
  readonly row: ChannelRow | null;

  constructor(row: ChannelRow | null) {
    this.row = row;
  }

  prepare(sql: string) {
    return new ShadowStatement(this, sql);
  }
}

function channel(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "canary-room",
    owner_uid: "private-owner",
    passcode: "private-passcode-hash",
    is_frozen: 0,
    instance_id: "instance-1",
    show_on_profile: 0,
    projection_source_version: 4,
    ...overrides,
  };
}

function env(input: {
  control?: ShadowDatabase;
  canary?: ShadowDatabase;
  allowlist?: string;
  reportsChannelId?: string;
} = {}): Env {
  return {
    DB: (input.control || new ShadowDatabase(channel())) as unknown as D1Database,
    CHAT_DB_CANARY_A: (
      input.canary || new ShadowDatabase(channel())
    ) as unknown as D1Database,
    D1_CANARY_SHADOW_CHANNELS: input.allowlist,
    REPORTS_CHANNEL_ID: input.reportsChannelId,
  } as unknown as Env;
}

test("shadow allowlist is strict, bounded, and rejects duplicate placement", () => {
  assert.deepEqual(parseCanaryChannelShadowAllowlist(undefined), []);
  assert.deepEqual(
    parseCanaryChannelShadowAllowlist(
      "canary-a:canary-room,canary-b:second-room",
    ),
    [
      { shardId: "canary-a", channelId: "canary-room" },
      { shardId: "canary-b", channelId: "second-room" },
    ],
  );

  for (const invalid of [
    "canary-c:canary-room",
    "canary-a:room_live",
    "canary-a:UPPERCASE",
    "canary-a:canary-room,canary-a:canary-room",
    "canary-a:canary-room,canary-b:canary-room",
    "canary-a:canary-room,",
    Array.from({ length: 21 }, (_, index) => `canary-a:room-${index}`)
      .join(","),
  ]) {
    assert.equal(parseCanaryChannelShadowAllowlist(invalid), null, invalid);
  }
});

test("normal and live entry paths resolve to one parent placement", () => {
  const inputEnv = env({
    allowlist: "canary-a:canary-room",
  });
  assert.deepEqual(
    resolveCanaryChannelShadowPlacement(inputEnv, "canary-room"),
    { shardId: "canary-a", channelId: "canary-room" },
  );
  assert.deepEqual(
    resolveCanaryChannelShadowPlacement(inputEnv, "canary-room_live"),
    { shardId: "canary-a", channelId: "canary-room" },
  );
  assert.equal(
    resolveCanaryChannelShadowPlacement(inputEnv, "other-room"),
    null,
  );
  assert.equal(
    resolveCanaryChannelShadowPlacement(
      env({
        allowlist: "canary-a:canary-room",
        reportsChannelId: "canary-room",
      }),
      "canary-room",
    ),
    null,
  );
});

test("shadow comparison reads one explicit metadata row from each database", async () => {
  const control = new ShadowDatabase(channel());
  const canary = new ShadowDatabase(channel());
  const result = await compareCanaryChannelShadow(
    env({ control, canary }),
    { shardId: "canary-a", channelId: "canary-room" },
  );

  assert.deepEqual(result, { matches: true, mismatches: [] });
  assert.equal(control.queries.length, 1);
  assert.equal(canary.queries.length, 1);
  assert.deepEqual(control.queries[0].values, ["canary-room"]);
  assert.doesNotMatch(control.queries[0].sql, /SELECT\s+\*/i);
  assert.doesNotMatch(
    control.queries[0].sql,
    /notice|profile_image|background|message|media/i,
  );
});

test("shadow comparison returns categories without exposing compared values", async () => {
  const result = await compareCanaryChannelShadow(
    env({
      control: new ShadowDatabase(channel()),
      canary: new ShadowDatabase(channel({
        owner_uid: "different-owner",
        passcode: "different-passcode-hash",
        is_frozen: 1,
        instance_id: "instance-2",
        show_on_profile: 1,
        projection_source_version: 3,
      })),
    }),
    { shardId: "canary-a", channelId: "canary-room" },
  );

  assert.deepEqual(result, {
    matches: false,
    mismatches: [
      "owner_mismatch",
      "access_state_mismatch",
      "instance_mismatch",
      "visibility_mismatch",
      "projection_version_mismatch",
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /private|different|instance-/);
});

test("shadow comparison distinguishes missing control and canary rows", async () => {
  assert.deepEqual(
    await compareCanaryChannelShadow(
      env({ control: new ShadowDatabase(null) }),
      { shardId: "canary-a", channelId: "canary-room" },
    ),
    { matches: false, mismatches: ["missing_control"] },
  );
  assert.deepEqual(
    await compareCanaryChannelShadow(
      env({ canary: new ShadowDatabase(null) }),
      { shardId: "canary-a", channelId: "canary-room" },
    ),
    { matches: false, mismatches: ["missing_canary"] },
  );
});

test("init schedules shadow work only after a successful GET response", () => {
  const indexSource = readFileSync(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );
  const shadowSource = readFileSync(
    new URL("../src/lib/canary-channel-shadow.ts", import.meta.url),
    "utf8",
  );
  const productionWrangler = readFileSync(
    new URL("../wrangler.toml", import.meta.url),
    "utf8",
  );

  assert.match(
    indexSource,
    /response = await handleInitWithRetry\(request, env\);[\s\S]*request\.method === "GET" && response\.ok[\s\S]*ctx\.waitUntil\(observeCanaryChannelShadow/,
  );
  assert.match(shadowSource, /EVENT_COOLDOWN_MS = 5 \* 60 \* 1000/);
  assert.doesNotMatch(shadowSource, /actorUserId/);
  assert.doesNotMatch(
    shadowSource,
    /detail:[\s\S]{0,300}(owner_uid|passcode|instance_id)/,
  );
  assert.doesNotMatch(productionWrangler, /D1_CANARY_SHADOW_CHANNELS/);
});
