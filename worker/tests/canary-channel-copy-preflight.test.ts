import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleCanaryChannelCopyPreflight } from "../src/routes/canary-channel-copy-operations.ts";
import {
  CANARY_CHANNEL_COPY_TABLES,
} from "../src/lib/canary-channel-copy-preflight.ts";
import type { Env } from "../src/types.ts";

const OPERATOR_TOKEN = "operator-token-at-least-thirty-two-characters";

class PreflightStatement {
  private readonly database: PreflightDatabase;
  readonly sql: string;
  private readonly values: unknown[];

  constructor(
    database: PreflightDatabase,
    sql: string,
    values: unknown[] = [],
  ) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new PreflightStatement(this.database, this.sql, values);
  }

  async first<T>() {
    this.database.queries.push({ sql: this.sql, values: this.values });
    if (this.sql.includes("chat_shard_metadata")) {
      return this.database.metadata as T | null;
    }
    return this.database.sourceState as T | null;
  }

  async all<T>() {
    this.database.queries.push({ sql: this.sql, values: this.values });
    return {
      results: CANARY_CHANNEL_COPY_TABLES.map((table) => ({
        table_name: table,
        row_count: this.database.counts[table] || 0,
      })) as T[],
    };
  }
}

class PreflightDatabase {
  queries: Array<{ sql: string; values: unknown[] }> = [];
  counts: Record<string, number> = {};
  sourceState: Record<string, unknown> | null = {
    projection_source_version: 7,
    active_cleanup_jobs: 0,
    active_undo_rows: 0,
    pending_uploads: 0,
  };
  metadata: Record<string, unknown> | null = {
    shard_role: "chat-canary",
    bootstrap_version: 2,
  };

  prepare(sql: string) {
    return new PreflightStatement(this, sql);
  }

  async batch(statements: PreflightStatement[]) {
    return Promise.all(statements.map(async (statement) => {
      if (statement.sql.includes("UNION ALL")) return statement.all();
      return { results: [await statement.first()] };
    }));
  }
}

function env(input: {
  control?: PreflightDatabase;
  canary?: PreflightDatabase;
  reportsChannelId?: string;
  token?: string;
} = {}): Env {
  return {
    DB: (input.control || new PreflightDatabase()) as unknown as D1Database,
    CHAT_DB_CANARY_A: (
      input.canary || new PreflightDatabase()
    ) as unknown as D1Database,
    REPORTS_CHANNEL_ID: input.reportsChannelId,
    D1_CANARY_OPERATOR_TOKEN: input.token ?? OPERATOR_TOKEN,
  } as unknown as Env;
}

function request(query: string, token = OPERATOR_TOKEN, method = "GET") {
  return new Request(
    `https://worker.example/internal/d1-canary/copy-preflight${query}`,
    {
      method,
      headers: { "X-Canary-Operator-Token": token },
    },
  );
}

test("copy preflight is hidden and rejects reports or malformed placement", async () => {
  const inputEnv = env({ reportsChannelId: "reports" });
  assert.equal(
    (await handleCanaryChannelCopyPreflight(
      request("?shard=canary-a&channel=room-one", "wrong-token"),
      inputEnv,
    )).status,
    404,
  );
  for (const query of [
    "?shard=canary-c&channel=room-one",
    "?shard=canary-a&channel=room_one",
    "?shard=canary-a&channel=reports",
  ]) {
    const response = await handleCanaryChannelCopyPreflight(
      request(query),
      inputEnv,
    );
    assert.equal(response.status, 400, query);
  }
});

test("copy preflight reports metadata counts without selecting row content", async () => {
  const control = new PreflightDatabase();
  const canary = new PreflightDatabase();
  control.counts.messages = 12;
  control.counts.dm_replies = 2;

  const response = await handleCanaryChannelCopyPreflight(
    request("?shard=canary-a&channel=room-one"),
    env({ control, canary }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.projectionSourceVersion, 7);
  assert.deepEqual(body.blockers, []);
  assert.equal((body.sourceCounts as Record<string, number>).messages, 12);
  assert.equal((body.sourceCounts as Record<string, number>).dm_replies, 2);
  assert.doesNotMatch(JSON.stringify(body), /owner|passcode|message text|media/);
  assert.ok(
    control.queries.every(({ sql }) => (
      !/SELECT\s+\*/i.test(sql)
      && !/\b(text|payload_json|passcode|owner_uid|image)\b/i.test(sql)
    )),
  );
});

test("copy preflight fails closed on destination rows and source activity", async () => {
  const control = new PreflightDatabase();
  const canary = new PreflightDatabase();
  control.sourceState = {
    projection_source_version: 7,
    active_cleanup_jobs: 1,
    active_undo_rows: 1,
    pending_uploads: 1,
  };
  canary.counts.messages = 1;

  const response = await handleCanaryChannelCopyPreflight(
    request("?shard=canary-a&channel=room-one"),
    env({ control, canary }),
  );
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json() as { blockers: string[] }).blockers, [
    "destination_not_empty",
    "source_cleanup_active",
    "source_undo_active",
    "source_upload_pending",
  ]);
});

test("copy preflight fails closed on missing or aliased canary binding", async () => {
  const control = new PreflightDatabase();
  const missing = await handleCanaryChannelCopyPreflight(
    request("?shard=canary-a&channel=room-one"),
    {
      DB: control as unknown as D1Database,
      D1_CANARY_OPERATOR_TOKEN: OPERATOR_TOKEN,
    } as unknown as Env,
  );
  assert.equal(missing.status, 503);

  const aliased = await handleCanaryChannelCopyPreflight(
    request("?shard=canary-a&channel=room-one"),
    env({ control, canary: control }),
  );
  assert.equal(aliased.status, 503);
});

test("copy preflight remains read-only and absent from production config", () => {
  const routeSource = readFileSync(
    new URL("../src/routes/canary-channel-copy-operations.ts", import.meta.url),
    "utf8",
  );
  const preflightSource = readFileSync(
    new URL("../src/lib/canary-channel-copy-preflight.ts", import.meta.url),
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

  assert.match(indexSource, /\/internal\/d1-canary\/copy-preflight/);
  assert.doesNotMatch(preflightSource, /\.run\(/);
  assert.doesNotMatch(
    preflightSource,
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i,
  );
  assert.doesNotMatch(routeSource, /POST|PUT|PATCH|DELETE/);
  assert.doesNotMatch(routeSource, /X-Internal-Token|X-User-Id/);
  assert.doesNotMatch(productionWrangler, /D1_CANARY_OPERATOR_TOKEN/);
});
