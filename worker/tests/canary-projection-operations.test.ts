import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleCanaryProjectionReconciliation } from "../src/routes/canary-projection-operations.ts";
import type { Env } from "../src/types.ts";

const OPERATOR_TOKEN = "operator-token-at-least-thirty-two-characters";
const routeSource = readFileSync(
  new URL("../src/routes/canary-projection-operations.ts", import.meta.url),
  "utf8",
);
const operatorAuthSource = readFileSync(
  new URL("../src/lib/canary-operator-auth.ts", import.meta.url),
  "utf8",
);
const indexSource = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);
const productionWrangler = readFileSync(
  new URL("../wrangler.toml", import.meta.url),
  "utf8",
);

class OperatorStatement {
  private readonly database: OperatorDatabase;
  readonly sql: string;
  private readonly values: unknown[];

  constructor(
    database: OperatorDatabase,
    sql: string,
    values: unknown[] = [],
  ) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new OperatorStatement(this.database, this.sql, values);
  }

  async all<T>() {
    this.database.queries.push({ sql: this.sql, values: this.values });
    return { results: this.database.results as T[] };
  }
}

class OperatorDatabase {
  results: Array<Record<string, unknown>> = [];
  queries: Array<{ sql: string; values: unknown[] }> = [];

  prepare(sql: string) {
    return new OperatorStatement(this, sql);
  }
}

function env(input: {
  control?: OperatorDatabase;
  canaryA?: OperatorDatabase;
  token?: string;
} = {}): Env {
  return {
    DB: (input.control || new OperatorDatabase()) as unknown as D1Database,
    CHAT_DB_CANARY_A: input.canaryA as unknown as D1Database,
    D1_CANARY_OPERATOR_TOKEN: input.token,
  } as unknown as Env;
}

function request(input: {
  token?: string;
  method?: string;
  query?: string;
} = {}): Request {
  const headers = new Headers();
  if (input.token) headers.set("X-Canary-Operator-Token", input.token);
  return new Request(
    `https://worker.example/internal/d1-canary/reconcile${input.query || ""}`,
    { method: input.method || "GET", headers },
  );
}

test("canary reconciliation is hidden without its dedicated operator secret", async () => {
  const control = new OperatorDatabase();
  const canary = new OperatorDatabase();

  for (const testRequest of [
    request(),
    request({ token: "wrong-token-with-at-least-thirty-two-characters" }),
  ]) {
    const response = await handleCanaryProjectionReconciliation(
      testRequest,
      env({ control, canaryA: canary, token: OPERATOR_TOKEN }),
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }

  const disabled = await handleCanaryProjectionReconciliation(
    request({ token: OPERATOR_TOKEN }),
    env({ control, canaryA: canary }),
  );
  assert.equal(disabled.status, 404);
  assert.equal(control.queries.length, 0);
  assert.equal(canary.queries.length, 0);
  assert.doesNotMatch(productionWrangler, /D1_CANARY_OPERATOR_TOKEN/);
});

test("canary reconciliation rejects mutation methods and malformed bounds", async () => {
  const inputEnv = env({
    canaryA: new OperatorDatabase(),
    token: OPERATOR_TOKEN,
  });
  const mutation = await handleCanaryProjectionReconciliation(
    request({
      token: OPERATOR_TOKEN,
      method: "POST",
      query: "?shard=canary-a",
    }),
    inputEnv,
  );
  assert.equal(mutation.status, 405);
  assert.equal(mutation.headers.get("Allow"), "GET");

  for (const query of [
    "?shard=canary-c",
    "?shard=canary-a&limit=0",
    "?shard=canary-a&limit=101",
    "?shard=canary-a&limit=1.5",
    "?shard=canary-a&cursor=../../control",
  ]) {
    const response = await handleCanaryProjectionReconciliation(
      request({ token: OPERATOR_TOKEN, query }),
      inputEnv,
    );
    assert.equal(response.status, 400, query);
  }
});

test("canary reconciliation fails closed on missing or control-aliased bindings", async () => {
  const control = new OperatorDatabase();
  const missing = await handleCanaryProjectionReconciliation(
    request({ token: OPERATOR_TOKEN, query: "?shard=canary-a" }),
    env({ control, token: OPERATOR_TOKEN }),
  );
  assert.equal(missing.status, 503);

  const aliased = await handleCanaryProjectionReconciliation(
    request({ token: OPERATOR_TOKEN, query: "?shard=canary-a" }),
    env({ control, canaryA: control, token: OPERATOR_TOKEN }),
  );
  assert.equal(aliased.status, 503);
  assert.equal(control.queries.length, 0);
});

test("canary reconciliation returns one bounded metadata-only page", async () => {
  const source = new OperatorDatabase();
  const control = new OperatorDatabase();
  source.results = [{
    channel_id: "canary-room",
    source_version: 2,
    state: "active",
    owner_uid: "owner-private",
    show_on_profile: 1,
    created_at: "2026-09-10T00:00:00.000Z",
  }];
  control.results = [{
    channel_id: "canary-room",
    source_version: 1,
    state: "active",
    projected_source_version: 1,
    owner_uid: "owner-old",
    show_on_profile: 0,
    created_at: "2026-09-09T00:00:00.000Z",
  }];

  const response = await handleCanaryProjectionReconciliation(
    request({
      token: OPERATOR_TOKEN,
      query: "?shard=canary-a&cursor=canary-old&limit=1",
    }),
    env({ control, canaryA: source, token: OPERATOR_TOKEN }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, {
    shardId: "canary-a",
    checked: 1,
    issues: [{
      channelId: "canary-room",
      reason: "watermark_mismatch",
      sourceVersion: 2,
      controlVersion: 1,
    }],
    nextCursor: "canary-room",
  });
  assert.equal(source.queries.length, 1);
  assert.equal(control.queries.length, 1);
  assert.deepEqual(source.queries[0].values, ["canary-old", 1]);
  assert.doesNotMatch(JSON.stringify(body), /owner-private|owner-old/);
});

test("internal reconciliation route never exposes a browser proxy contract", () => {
  assert.match(
    indexSource,
    /url\.pathname === "\/internal\/d1-canary\/reconcile"[\s\S]*handleCanaryProjectionReconciliation/,
  );
  assert.match(operatorAuthSource, /MIN_OPERATOR_TOKEN_LENGTH = 32/);
  assert.match(routeSource, /MAX_RECONCILIATION_LIMIT = 100/);
  assert.match(operatorAuthSource, /mismatch \|=/);
  assert.doesNotMatch(routeSource, /X-Internal-Token|X-User-Id/);
  assert.doesNotMatch(routeSource, /payload_json|passcode|message_text|media_key/);
  assert.doesNotMatch(
    indexSource,
    /Access-Control-Allow-Headers[^\n]*X-Canary-Operator-Token/,
  );
});
