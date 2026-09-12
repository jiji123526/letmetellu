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
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      projection_source_version INTEGER NOT NULL
    );
    CREATE TABLE moderators (
      channel_id TEXT NOT NULL,
      uid TEXT NOT NULL,
      role TEXT,
      created_at TEXT,
      PRIMARY KEY (channel_id, uid)
    );
    CREATE TABLE blocked (
      id TEXT PRIMARY KEY,
      uid TEXT,
      reason TEXT,
      fingerprint TEXT,
      channel_id TEXT NOT NULL,
      created_at TEXT,
      device_id TEXT
    );
    CREATE TABLE banned_words (
      id TEXT PRIMARY KEY,
      word TEXT,
      channel_id TEXT NOT NULL,
      expires TEXT,
      created_at TEXT
    );
    CREATE TABLE channel_moderation (
      channel_id TEXT PRIMARY KEY,
      status TEXT,
      warning_sent_at TEXT,
      warned_report_count INTEGER,
      suspension_notice_sent_at TEXT,
      suspension_reason TEXT,
      frozen_at TEXT,
      frozen_by TEXT,
      petition_status TEXT,
      current_petition_id TEXT,
      updated_at TEXT
    );
    CREATE TABLE channel_petitions (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      owner_uid TEXT,
      text TEXT,
      status TEXT,
      created_at TEXT,
      resolved_at TEXT,
      resolved_by TEXT,
      resolution_note TEXT,
      inbox_message_id TEXT
    );
    CREATE TABLE config (
      id TEXT PRIMARY KEY,
      text TEXT,
      channel_id TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE upload_tickets (
      id TEXT PRIMARY KEY,
      key TEXT,
      channel_id TEXT NOT NULL,
      uid TEXT,
      auth_uid TEXT,
      purpose TEXT,
      ip_hash TEXT,
      status TEXT,
      attached_record_id TEXT,
      attached_record_type TEXT,
      created_at TEXT,
      expires_at TEXT
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
        cursor_row_id TEXT,
        stage_rows_copied INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
  return database;
}

function copyRequest() {
  return new Request("https://worker.example/internal/d1-canary/copy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Canary-Copy-Token": COPY_TOKEN,
    },
    body: JSON.stringify({
      action: "copy-policy-config",
      shard: "canary-a",
      channel: "room-one",
    }),
  });
}

function copyEnv(source: DatabaseSync, destination: DatabaseSync): Env {
  return {
    DB: new SqliteD1(source) as unknown as D1Database,
    CHAT_DB_CANARY_A: new SqliteD1(destination) as unknown as D1Database,
    D1_CANARY_COPY_TOKEN: COPY_TOKEN,
  } as unknown as Env;
}

function insertJob(destination: DatabaseSync, stage = "channels_copied") {
  destination.prepare(`
    INSERT INTO canary_channel_copy_jobs (
      channel_id, source_projection_version, stage, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?)
  `).run("room-one", 7, stage, "2026-09-11T00:00:00.000Z", "2026-09-11T00:00:00.000Z");
}

test("policy copy is bounded, resumable, ordered, and does not leak row data", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  source.prepare(`
    INSERT INTO channels (id, projection_source_version) VALUES (?, ?)
  `).run("room-one", 7);
  insertJob(destination);
  const moderatorInsert = source.prepare(`
    INSERT INTO moderators (channel_id, uid, role, created_at)
    VALUES ('room-one', ?, 'moderator', '2026-09-11T00:00:00.000Z')
  `);
  for (let index = 0; index < 105; index += 1) {
    moderatorInsert.run(`user-${String(index).padStart(3, "0")}`);
  }
  source.prepare(`
    INSERT INTO blocked (
      id, uid, reason, fingerprint, channel_id, created_at, device_id
    ) VALUES ('blocked-1', 'user-private', 'private reason', 'private fingerprint',
      'room-one', '2026-09-11T00:00:00.000Z', 'private device')
  `).run();
  source.prepare(`
    INSERT INTO banned_words (id, word, channel_id, expires, created_at)
    VALUES ('word-1', 'private word', 'room-one', NULL, '2026-09-11T00:00:00.000Z')
  `).run();
  source.prepare(`
    INSERT INTO channel_moderation (
      channel_id, status, warned_report_count, suspension_reason, updated_at
    ) VALUES ('room-one', 'active', 2, 'private suspension',
      '2026-09-11T00:00:00.000Z')
  `).run();
  source.prepare(`
    INSERT INTO channel_petitions (
      id, channel_id, owner_uid, text, status, created_at, resolution_note
    ) VALUES ('petition-1', 'room-one', 'private-owner', 'private petition',
      'pending', '2026-09-11T00:00:00.000Z', 'private resolution')
  `).run();
  source.prepare(`
    INSERT INTO config (id, text, channel_id, updated_at)
    VALUES ('notice', 'private config', 'room-one', '2026-09-11T00:00:00.000Z')
  `).run();
  source.prepare(`
    INSERT INTO upload_tickets (
      id, key, channel_id, uid, auth_uid, purpose, ip_hash, status,
      attached_record_id, attached_record_type, created_at, expires_at
    ) VALUES ('ticket-1', 'private key', 'room-one', 'private uid',
      'private auth', 'message', 'private ip', 'pending', NULL, NULL,
      '2026-09-11T00:00:00.000Z', '2026-09-11T01:00:00.000Z')
  `).run();

  const first = await handleCanaryChannelCopyMutation(
    copyRequest(),
    copyEnv(source, destination),
  );
  const firstBody = await first.json() as Record<string, unknown>;
  assert.equal(first.status, 200);
  assert.equal(firstBody.stage, "channels_copied");
  assert.equal(firstBody.batchRowsCopied, 100);
  assert.equal(firstBody.stageRowsCopied, 100);
  assert.equal(firstBody.hasMore, true);
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM moderators").get()?.count, 100);

  const second = await handleCanaryChannelCopyMutation(
    copyRequest(),
    copyEnv(source, destination),
  );
  const secondBody = await second.json() as Record<string, unknown>;
  assert.equal(secondBody.stage, "moderators_copied");
  assert.equal(secondBody.batchRowsCopied, 5);
  assert.equal(secondBody.stageRowsCopied, 105);
  assert.equal(secondBody.hasMore, false);

  const responses = [JSON.stringify(firstBody), JSON.stringify(secondBody)];
  for (let index = 0; index < 6; index += 1) {
    const response = await handleCanaryChannelCopyMutation(
      copyRequest(),
      copyEnv(source, destination),
    );
    assert.equal(response.status, 200);
    responses.push(JSON.stringify(await response.json()));
  }
  const job = destination.prepare(`
    SELECT stage, cursor_channel_id, cursor_row_id, stage_rows_copied
    FROM canary_channel_copy_jobs WHERE channel_id = 'room-one'
  `).get();
  assert.deepEqual({ ...job }, {
    stage: "upload_tickets_copied",
    cursor_channel_id: null,
    cursor_row_id: null,
    stage_rows_copied: 0,
  });
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM blocked").get()?.count, 1);
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM upload_tickets").get()?.count, 1);
  assert.doesNotMatch(
    responses.join("\n"),
    /private reason|private word|private petition|private config|private key|private ip/,
  );
});

test("policy copy fails closed when the pinned source version changes", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  source.prepare(`
    INSERT INTO channels (id, projection_source_version) VALUES (?, ?)
  `).run("room-one", 8);
  insertJob(destination);
  source.prepare(`
    INSERT INTO moderators (channel_id, uid, role)
    VALUES ('room-one', 'moderator-1', 'moderator')
  `).run();

  const response = await handleCanaryChannelCopyMutation(
    copyRequest(),
    copyEnv(source, destination),
  );
  assert.equal(response.status, 409);
  const body = await response.json() as { blockers: string[]; status: string };
  assert.equal(body.status, "failed");
  assert.deepEqual(body.blockers, ["source_version_changed"]);
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM moderators").get()?.count, 0);
  assert.equal(destination.prepare(`
    SELECT status FROM canary_channel_copy_jobs WHERE channel_id = 'room-one'
  `).get()?.status, "failed");
});
