import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleCanaryChannelCopyMutation } from "../src/routes/canary-channel-copy-mutations.ts";
import type { Env } from "../src/types.ts";

const COPY_TOKEN = "copy-token-that-is-at-least-thirty-two-characters";

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
    return {
      results: this.database.prepare(this.sql).all(...this.values) as T[],
    };
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

function createDatabase(includeJob = false): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      projection_source_version INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      client_message_id TEXT,
      uid TEXT NOT NULL,
      auth_uid TEXT NOT NULL,
      nick TEXT,
      text TEXT,
      is_admin INTEGER,
      reply_to TEXT REFERENCES messages(id) ON DELETE SET NULL,
      root_id TEXT,
      report INTEGER,
      reported_msg_id TEXT,
      gallery_id TEXT,
      dm INTEGER,
      deleted INTEGER,
      edited INTEGER,
      reported INTEGER,
      reactions TEXT,
      image TEXT,
      image_w INTEGER,
      image_h INTEGER,
      fingerprint TEXT,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      created_at TEXT
    );
    CREATE TABLE pending_admin_deletions (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL
    );
  `);
  if (includeJob) {
    database.exec(`
      CREATE TABLE canary_channel_copy_jobs (
        channel_id TEXT PRIMARY KEY,
        source_projection_version INTEGER NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        cursor_channel_id TEXT,
        cursor_created_at TEXT,
        cursor_row_id TEXT,
        message_snapshot_created_at TEXT,
        message_snapshot_id TEXT,
        stage_rows_copied INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
  database.prepare(`
    INSERT INTO channels (id, projection_source_version) VALUES (?, ?)
  `).run("room-one", 7);
  database.prepare(`
    INSERT INTO channels (id, projection_source_version) VALUES (?, ?)
  `).run("room-one_live", 7);
  return database;
}

function insertJob(destination: DatabaseSync) {
  destination.prepare(`
    INSERT INTO canary_channel_copy_jobs (
      channel_id, source_projection_version, stage, status, created_at, updated_at
    ) VALUES (?, ?, 'upload_tickets_copied', 'active', ?, ?)
  `).run(
    "room-one",
    7,
    "2026-09-13T00:00:00.000Z",
    "2026-09-13T00:00:00.000Z",
  );
}

function insertMessage(input: {
  database: DatabaseSync;
  id: string;
  createdAt: string;
  replyTo?: string;
  text?: string;
}) {
  input.database.prepare(`
    INSERT INTO messages (
      id, client_message_id, uid, auth_uid, nick, text, is_admin, reply_to,
      root_id, report, reported_msg_id, gallery_id, dm, deleted, edited,
      reported, reactions, image, image_w, image_h, fingerprint, channel_id,
      created_at
    ) VALUES (?, ?, 'visitor', 'anonymous', 'nick', ?, 0, ?, ?, 0, NULL,
      NULL, 0, 0, 0, 0, '{}', NULL, NULL, NULL, 'private-fingerprint',
      'room-one', ?)
  `).run(
    input.id,
    `client-${input.id}`,
    input.text || `private-${input.id}`,
    input.replyTo || null,
    input.replyTo || input.id,
    input.createdAt,
  );
}

function copyEnv(source: DatabaseSync, destination: DatabaseSync): Env {
  return {
    DB: new SqliteD1(source) as unknown as D1Database,
    CHAT_DB_CANARY_A: new SqliteD1(destination) as unknown as D1Database,
    D1_CANARY_COPY_TOKEN: COPY_TOKEN,
  } as unknown as Env;
}

function copyRequest() {
  return new Request("https://worker.example/internal/d1-canary/copy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Canary-Copy-Token": COPY_TOKEN,
    },
    body: JSON.stringify({
      action: "copy-messages",
      shard: "canary-a",
      channel: "room-one",
    }),
  });
}

test("message history copy is snapshot-bounded, resumable, and parent-first", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  insertJob(destination);
  for (let index = 0; index < 55; index += 1) {
    insertMessage({
      database: source,
      id: `root-${String(index).padStart(3, "0")}`,
      createdAt: `2026-09-13T00:${String(index).padStart(2, "0")}:00.000Z`,
    });
  }
  insertMessage({
    database: source,
    id: "reply-001",
    replyTo: "root-000",
    createdAt: "2026-09-13T01:00:00.000Z",
  });
  insertMessage({
    database: source,
    id: "reply-002",
    replyTo: "root-054",
    createdAt: "2026-09-13T01:01:00.000Z",
  });

  const first = await handleCanaryChannelCopyMutation(
    copyRequest(),
    copyEnv(source, destination),
  );
  const firstBody = await first.json() as Record<string, unknown>;
  assert.equal(first.status, 200);
  assert.equal(firstBody.stage, "upload_tickets_copied");
  assert.equal(firstBody.batchRowsCopied, 50);
  assert.equal(firstBody.hasMore, true);
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM messages").get()?.count, 50);
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM messages WHERE reply_to IS NOT NULL").get()?.count, 0);

  insertMessage({
    database: source,
    id: "after-snapshot",
    createdAt: "2026-09-13T02:00:00.000Z",
  });

  const second = await handleCanaryChannelCopyMutation(
    copyRequest(),
    copyEnv(source, destination),
  );
  const secondBody = await second.json() as Record<string, unknown>;
  assert.equal(secondBody.stage, "message_roots_copied");
  assert.equal(secondBody.batchRowsCopied, 5);
  assert.equal(secondBody.hasMore, false);

  const third = await handleCanaryChannelCopyMutation(
    copyRequest(),
    copyEnv(source, destination),
  );
  const thirdBody = await third.json() as Record<string, unknown>;
  assert.equal(thirdBody.stage, "messages_copied");
  assert.equal(thirdBody.batchRowsCopied, 2);
  assert.equal(thirdBody.hasMore, false);
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM messages").get()?.count, 57);
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM messages WHERE reply_to IS NOT NULL").get()?.count, 2);
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM messages WHERE id = 'after-snapshot'").get()?.count, 0);
  assert.doesNotMatch(
    JSON.stringify([firstBody, secondBody, thirdBody]),
    /private-|visitor|anonymous|fingerprint/,
  );

  const retry = await handleCanaryChannelCopyMutation(
    copyRequest(),
    copyEnv(source, destination),
  );
  const retryBody = await retry.json() as Record<string, unknown>;
  assert.equal(retryBody.idempotent, true);
  assert.equal(retryBody.batchRowsCopied, 0);
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM messages").get()?.count, 57);
});

test("message history copy fails closed while an undo deletion is active", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  insertJob(destination);
  insertMessage({
    database: source,
    id: "root-001",
    createdAt: "2026-09-13T00:00:00.000Z",
  });
  source.prepare(`
    INSERT INTO pending_admin_deletions (id, channel_id) VALUES (?, ?)
  `).run("undo-1", "room-one");

  const response = await handleCanaryChannelCopyMutation(
    copyRequest(),
    copyEnv(source, destination),
  );
  assert.equal(response.status, 409);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.status, "failed");
  assert.deepEqual(body.blockers, ["source_undo_active"]);
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM messages").get()?.count, 0);
});
