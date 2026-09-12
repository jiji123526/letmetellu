import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleCanaryChannelCopyMutation } from "../src/routes/canary-channel-copy-mutations.ts";
import { CANARY_CHANNEL_COPY_TABLES } from "../src/lib/canary-channel-copy-preflight.ts";
import type { Env } from "../src/types.ts";

const COPY_TOKEN = "copy-token-that-is-at-least-thirty-two-characters";
const OPERATOR_TOKEN = "operator-token-at-least-thirty-two-characters";

interface Job {
  channel_id: string;
  source_projection_version: number;
  stage: "prepared" | "channels_copied";
  status: "active" | "failed";
}

function canonicalChannel(id = "room-one") {
  return {
    id,
    owner_uid: "private-owner",
    name: "Private channel name",
    profile_image: "private-profile",
    bubble_color: "#000000",
    passcode: "private-passcode-hash",
    notice: "private notice",
    is_frozen: 0,
    created_at: "2026-09-10T00:00:00.000Z",
    passcode_hint: "private hint",
    instance_id: "instance-1",
    show_on_profile: 0,
    background_type: "default",
    background_color: null,
    background_image: "private-background",
    background_overlay: 14,
    background_blur: 0,
    projection_source_version: 7,
  };
}

class CopyStatement {
  readonly database: CopyDatabase;
  readonly sql: string;
  readonly values: unknown[];

  constructor(database: CopyDatabase, sql: string, values: unknown[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new CopyStatement(this.database, this.sql, values);
  }

  first<T>() {
    return this.database.first(this) as Promise<T | null>;
  }

  all<T>() {
    return this.database.all(this) as Promise<{ results: T[] }>;
  }

  run() {
    return this.database.run(this);
  }
}

class CopyDatabase {
  readonly role: "source" | "destination";
  queries: Array<{ sql: string; values: unknown[] }> = [];
  job: Job | null = null;
  sourceVersion = 7;
  sourceRows = [canonicalChannel(), canonicalChannel("room-one_live")];
  destinationRows: Array<Record<string, unknown>> = [];

  constructor(role: "source" | "destination") {
    this.role = role;
  }

  prepare(sql: string) {
    return new CopyStatement(this, sql);
  }

  async first(statement: CopyStatement) {
    this.queries.push({ sql: statement.sql, values: statement.values });
    if (statement.sql.includes("chat_shard_metadata")) {
      return { shard_role: "chat-canary", bootstrap_version: 3 };
    }
    if (statement.sql.includes("canary_channel_copy_jobs")) return this.job;
    if (statement.sql.includes("FROM channels AS channel")) {
      return {
        projection_source_version: this.sourceVersion,
        active_cleanup_jobs: 0,
        active_undo_rows: 0,
        pending_uploads: 0,
      };
    }
    if (statement.sql.includes("SELECT projection_source_version")) {
      return { projection_source_version: this.sourceVersion };
    }
    return null;
  }

  async all(statement: CopyStatement) {
    this.queries.push({ sql: statement.sql, values: statement.values });
    if (statement.sql.includes("UNION ALL")) {
      return {
        results: CANARY_CHANNEL_COPY_TABLES.map((table) => ({
          table_name: table,
          row_count: table === "channels"
            ? this.destinationRows.length
            : 0,
        })),
      };
    }
    if (statement.sql.includes("FROM channels")) {
      return { results: this.sourceRows };
    }
    return { results: [] };
  }

  async run(statement: CopyStatement) {
    this.queries.push({ sql: statement.sql, values: statement.values });
    if (statement.sql.includes("INSERT INTO canary_channel_copy_jobs")) {
      if (this.job) return { meta: { changes: 0 } };
      this.job = {
        channel_id: String(statement.values[0]),
        source_projection_version: Number(statement.values[1]),
        stage: "prepared",
        status: "active",
      };
      return { meta: { changes: 1 } };
    }
    if (
      statement.sql.includes("UPDATE canary_channel_copy_jobs")
      && statement.sql.includes("status = 'failed'")
      && this.job
    ) {
      this.job.status = "failed";
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  }

  async batch(statements: CopyStatement[]) {
    if (statements.some((statement) => (
      statement.sql.includes("INSERT INTO channels")
    ))) {
      const channelStatements = statements.slice(0, -1);
      this.destinationRows.push(
        ...channelStatements.map((statement) => ({
          id: statement.values[0],
          owner_uid: statement.values[1],
          passcode: statement.values[5],
        })),
      );
      if (this.job) this.job.stage = "channels_copied";
      return statements.map(() => ({ results: [], meta: { changes: 1 } }));
    }
    return Promise.all(statements.map(async (statement) => {
      if (statement.sql.includes("UNION ALL")) return this.all(statement);
      return { results: [await this.first(statement)] };
    }));
  }
}

function env(source: CopyDatabase, destination: CopyDatabase): Env {
  return {
    DB: source as unknown as D1Database,
    CHAT_DB_CANARY_A: destination as unknown as D1Database,
    D1_CANARY_COPY_TOKEN: COPY_TOKEN,
    D1_CANARY_OPERATOR_TOKEN: OPERATOR_TOKEN,
  } as unknown as Env;
}

function request(
  body: Record<string, unknown>,
  token = COPY_TOKEN,
  method = "POST",
) {
  return new Request("https://worker.example/internal/d1-canary/copy", {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Canary-Copy-Token": token,
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

const startCommand = {
  action: "start",
  shard: "canary-a",
  channel: "room-one",
};

test("copy mutation requires its distinct secret and exact command", async () => {
  const source = new CopyDatabase("source");
  const destination = new CopyDatabase("destination");
  const inputEnv = env(source, destination);
  assert.equal(
    (await handleCanaryChannelCopyMutation(
      request(startCommand, OPERATOR_TOKEN),
      inputEnv,
    )).status,
    404,
  );
  assert.equal(source.queries.length, 0);
  assert.equal(destination.queries.length, 0);

  const extraField = await handleCanaryChannelCopyMutation(
    request({ ...startCommand, unexpected: true }),
    inputEnv,
  );
  assert.equal(extraField.status, 400);
});

test("copy mutation refuses to run while projection dispatch is enabled", async () => {
  const source = new CopyDatabase("source");
  const destination = new CopyDatabase("destination");
  const inputEnv = {
    ...env(source, destination),
    D1_CANARY_PROJECTION_DISPATCH_ENABLED: "true",
  };
  const response = await handleCanaryChannelCopyMutation(
    request(startCommand),
    inputEnv,
  );
  assert.equal(response.status, 409);
  assert.equal(source.queries.length, 0);
  assert.equal(destination.queries.length, 0);
});

test("copy start creates one idempotent version-pinned job", async () => {
  const source = new CopyDatabase("source");
  const destination = new CopyDatabase("destination");
  const inputEnv = env(source, destination);

  const first = await handleCanaryChannelCopyMutation(
    request(startCommand),
    inputEnv,
  );
  assert.equal(first.status, 200);
  assert.equal((await first.json() as { idempotent: boolean }).idempotent, false);
  assert.equal(destination.job?.source_projection_version, 7);

  const retry = await handleCanaryChannelCopyMutation(
    request(startCommand),
    inputEnv,
  );
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { idempotent: boolean }).idempotent, true);
});

test("canonical stage copies parent and live rows without returning secrets", async () => {
  const source = new CopyDatabase("source");
  const destination = new CopyDatabase("destination");
  const inputEnv = env(source, destination);
  await handleCanaryChannelCopyMutation(request(startCommand), inputEnv);

  const command = {
    action: "copy-channels",
    shard: "canary-a",
    channel: "room-one",
  };
  const response = await handleCanaryChannelCopyMutation(
    request(command),
    inputEnv,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    shardId: "canary-a",
    channelId: "room-one",
    stage: "channels_copied",
    status: "active",
    idempotent: false,
    blockers: [],
  });
  assert.equal(destination.destinationRows.length, 2);
  assert.equal(destination.job?.stage, "channels_copied");
  assert.doesNotMatch(
    JSON.stringify(body),
    /private-owner|private-passcode|private notice|private-background/,
  );

  const retry = await handleCanaryChannelCopyMutation(
    request(command),
    inputEnv,
  );
  assert.equal((await retry.json() as { idempotent: boolean }).idempotent, true);
  assert.equal(destination.destinationRows.length, 2);
});

test("canonical stage rejects a changed source version before writing", async () => {
  const source = new CopyDatabase("source");
  const destination = new CopyDatabase("destination");
  const inputEnv = env(source, destination);
  await handleCanaryChannelCopyMutation(request(startCommand), inputEnv);
  source.sourceRows[0].projection_source_version = 8;

  const response = await handleCanaryChannelCopyMutation(
    request({
      action: "copy-channels",
      shard: "canary-a",
      channel: "room-one",
    }),
    inputEnv,
  );
  assert.equal(response.status, 409);
  assert.equal(destination.destinationRows.length, 0);
  assert.deepEqual(
    (await response.json() as { blockers: string[] }).blockers,
    ["source_version_changed"],
  );
});

test("copy mutation has no production secret or browser CORS contract", () => {
  const source = readFileSync(
    new URL("../src/routes/canary-channel-copy-mutations.ts", import.meta.url),
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
  assert.match(indexSource, /\/internal\/d1-canary\/copy/);
  assert.doesNotMatch(
    indexSource,
    /Access-Control-Allow-Headers[^\n]*X-Canary-Copy-Token/,
  );
  assert.doesNotMatch(source, /X-Internal-Token|X-User-Id/);
  assert.doesNotMatch(productionWrangler, /D1_CANARY_COPY_TOKEN/);
});
