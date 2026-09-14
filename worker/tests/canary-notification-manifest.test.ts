import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleCanaryMessageDelta } from "../src/routes/canary-message-delta.ts";
import type { Env } from "../src/types.ts";

const FINALIZE_TOKEN = "finalize-token-that-is-at-least-thirty-two-characters";

class SqliteStatement {
  private readonly database: DatabaseSync;
  readonly sql: string;
  private readonly values: unknown[];

  constructor(
    database: DatabaseSync,
    sql: string,
    values: unknown[] = [],
  ) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new SqliteStatement(this.database, this.sql, values);
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.values) || null) as T | null;
  }

  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.values) as T[] };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { results: [], meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1 {
  readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  prepare(sql: string) {
    return new SqliteStatement(this.database, sql);
  }

  async batch(statements: SqliteStatement[]) {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDatabase(destination = false) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      projection_source_version INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id)
    );
    CREATE TABLE message_notification_owners (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE pending_admin_deletions (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL);
    CREATE TABLE notification_preferences (user_id TEXT, channel_id TEXT);
    CREATE TABLE notification_outbox (id TEXT, channel_id TEXT);
    CREATE TABLE user_recent_channels (user_id TEXT, channel_id TEXT);
    CREATE TABLE cleanup_jobs (resource_type TEXT, resource_id TEXT);
    INSERT INTO channels VALUES ('room-one', 7), ('room-one_live', 7);
  `);
  if (destination) {
    database.exec(`
      CREATE TABLE canary_channel_copy_jobs (
        channel_id TEXT PRIMARY KEY,
        source_projection_version INTEGER NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        cursor_created_at TEXT,
        cursor_row_id TEXT,
        stage_rows_copied INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE canary_notification_reconciliation_seen (
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        PRIMARY KEY (channel_id, message_id)
      );
      INSERT INTO canary_channel_copy_jobs (
        channel_id, source_projection_version, stage, status, created_at, updated_at
      ) VALUES (
        'room-one', 7, 'delta_dm_verified', 'active',
        '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z'
      );
    `);
  }
  return database;
}

function insertOwner(database: DatabaseSync, index: number, user = `private-user-${index}`) {
  const messageId = `message-${String(index).padStart(3, "0")}`;
  const createdAt = `2026-09-14T00:${String(index).padStart(2, "0")}:00.000Z`;
  database.prepare("INSERT INTO messages (id, channel_id) VALUES (?, 'room-one')")
    .run(messageId);
  database.prepare(`
    INSERT INTO message_notification_owners (
      message_id, channel_id, user_id, created_at
    ) VALUES (?, 'room-one', ?, ?)
  `).run(messageId, user, createdAt);
  return messageId;
}

function env(source: DatabaseSync, destination: DatabaseSync): Env {
  return {
    DB: new SqliteD1(source) as unknown as D1Database,
    CHAT_DB_CANARY_A: new SqliteD1(destination) as unknown as D1Database,
    D1_CANARY_FINALIZE_TOKEN: FINALIZE_TOKEN,
    WRITE_MAINTENANCE_MODE: "true",
  } as unknown as Env;
}

function request(action: "reconcile-notification-owners" | "complete-notification-manifest") {
  return new Request("https://worker.example/internal/d1-canary/message-delta", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Canary-Finalize-Token": FINALIZE_TOKEN,
    },
    body: JSON.stringify({ action, shard: "canary-a", channel: "room-one" }),
  });
}

test("message notification ownership is reconciled in bounded batches", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  for (let index = 0; index < 45; index += 1) {
    const id = insertOwner(source, index);
    destination.prepare("INSERT INTO messages (id, channel_id) VALUES (?, 'room-one')").run(id);
  }
  insertOwner(destination, 99, "stale-private-user");

  const inputEnv = env(source, destination);
  let stage = "delta_dm_verified";
  const batchSizes: number[] = [];
  for (let call = 0; call < 10 && stage !== "delta_message_notification_owners_copied"; call += 1) {
    const response = await handleCanaryMessageDelta(
      request("reconcile-notification-owners"),
      inputEnv,
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { stage: string; batchRowsCopied?: number };
    assert.doesNotMatch(JSON.stringify(body), /private-user|stale-private/);
    if (body.batchRowsCopied !== undefined) batchSizes.push(body.batchRowsCopied);
    stage = body.stage;
  }
  assert.equal(stage, "delta_message_notification_owners_copied");
  assert.ok(batchSizes.every((size) => size <= 40));
  assert.equal(
    destination.prepare("SELECT COUNT(*) AS count FROM message_notification_owners").get()?.count,
    45,
  );
  assert.equal(
    destination.prepare("SELECT COUNT(*) AS count FROM message_notification_owners WHERE user_id = 'stale-private-user'").get()?.count,
    0,
  );

  const completed = await handleCanaryMessageDelta(
    request("complete-notification-manifest"),
    inputEnv,
  );
  assert.equal(completed.status, 200);
  assert.deepEqual(await completed.json(), {
    shardId: "canary-a",
    channelId: "room-one",
    stage: "delta_notification_manifest_verified",
    status: "active",
    idempotent: false,
    blockers: [],
  });
  assert.equal(
    destination.prepare("SELECT COUNT(*) AS count FROM canary_notification_reconciliation_seen").get()?.count,
    0,
  );
});

test("manifest verification rejects control-only notification state", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET stage = 'delta_message_notification_owners_copied'
  `).run();
  destination.prepare(`
    INSERT INTO notification_preferences (user_id, channel_id)
    VALUES ('private-user', 'room-one')
  `).run();

  const response = await handleCanaryMessageDelta(
    request("complete-notification-manifest"),
    env(source, destination),
  );
  assert.equal(response.status, 409);
  const body = await response.json() as { blockers: string[] };
  assert.deepEqual(body.blockers, ["control_only_notification_state_present"]);
  assert.doesNotMatch(JSON.stringify(body), /private-user/);
});
