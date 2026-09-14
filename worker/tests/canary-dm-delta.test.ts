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
    CREATE TABLE dm (
      id TEXT PRIMARY KEY,
      client_message_id TEXT,
      uid TEXT NOT NULL,
      auth_uid TEXT,
      nick TEXT,
      text TEXT,
      image TEXT,
      image_w INTEGER,
      image_h INTEGER,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      created_at TEXT,
      pending_delete_at TEXT,
      activity_at TEXT
    );
    CREATE TABLE dm_replies (
      id TEXT PRIMARY KEY,
      client_reply_id TEXT NOT NULL,
      dm_id TEXT NOT NULL REFERENCES dm(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      owner_uid TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      pending_delete_at TEXT,
      image TEXT,
      image_w INTEGER,
      image_h INTEGER,
      UNIQUE(owner_uid, client_reply_id)
    );
    CREATE TRIGGER dm_bump_activity_at_after_reply
    AFTER INSERT ON dm_replies
    BEGIN
      UPDATE dm SET activity_at = CASE
        WHEN activity_at IS NULL OR activity_at < NEW.created_at
          THEN NEW.created_at ELSE activity_at END
      WHERE id = NEW.dm_id;
    END;
    CREATE TABLE message_actor_identities (
      record_id TEXT NOT NULL,
      record_type TEXT NOT NULL,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      uid TEXT NOT NULL,
      device_id_hash TEXT NOT NULL,
      created_at TEXT,
      PRIMARY KEY (record_id, record_type)
    );
    CREATE TABLE dm_notification_owners (
      dm_id TEXT PRIMARY KEY REFERENCES dm(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE pending_admin_deletions (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL
    );
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
      CREATE TABLE canary_dm_reconciliation_seen (
        channel_id TEXT NOT NULL,
        record_type TEXT NOT NULL,
        record_id TEXT NOT NULL,
        PRIMARY KEY (channel_id, record_type, record_id)
      );
      INSERT INTO canary_channel_copy_jobs (
        channel_id, source_projection_version, stage, status, created_at, updated_at
      ) VALUES (
        'room-one', 7, 'delta_dm_roots_upserting', 'active',
        '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z'
      );
    `);
  }
  return database;
}

function insertDm(database: DatabaseSync, index: number, text = `private-dm-${index}`) {
  const id = `dm-${String(index).padStart(3, "0")}`;
  const createdAt = `2026-09-13T00:${String(index).padStart(2, "0")}:00.000Z`;
  database.prepare(`
    INSERT INTO dm (
      id, client_message_id, uid, auth_uid, nick, text, image, image_w,
      image_h, channel_id, created_at, pending_delete_at, activity_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'room-one', ?, NULL, ?)
  `).run(
    id,
    `client-${id}`,
    `private-visitor-${index}`,
    `private-auth-${index}`,
    `private-nick-${index}`,
    text,
    createdAt,
    createdAt,
  );
  return { id, createdAt };
}

function insertReply(database: DatabaseSync, dmId: string, index: number) {
  const id = `reply-${String(index).padStart(3, "0")}`;
  const createdAt = `2026-09-13T01:${String(index).padStart(2, "0")}:00.000Z`;
  database.prepare(`
    INSERT INTO dm_replies (
      id, client_reply_id, dm_id, channel_id, owner_uid, text, created_at,
      pending_delete_at, image, image_w, image_h
    ) VALUES (?, ?, ?, 'room-one', 'private-owner', ?, ?, NULL, NULL, NULL, NULL)
  `).run(id, `client-${id}`, dmId, `private-reply-${index}`, createdAt);
}

function env(source: DatabaseSync, destination: DatabaseSync): Env {
  return {
    DB: new SqliteD1(source) as unknown as D1Database,
    CHAT_DB_CANARY_A: new SqliteD1(destination) as unknown as D1Database,
    D1_CANARY_FINALIZE_TOKEN: FINALIZE_TOKEN,
    WRITE_MAINTENANCE_MODE: "true",
  } as unknown as Env;
}

function request(action: "reconcile-dm" | "complete-dm") {
  return new Request("https://worker.example/internal/d1-canary/message-delta", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Canary-Finalize-Token": FINALIZE_TOKEN,
    },
    body: JSON.stringify({ action, shard: "canary-a", channel: "room-one" }),
  });
}

test("frozen DM reconciliation is bounded, parent-first, and verified", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  for (let index = 0; index < 45; index += 1) {
    const root = insertDm(source, index);
    if (index < 42) insertReply(source, root.id, index);
    source.prepare(`
      INSERT INTO message_actor_identities
        (record_id, record_type, channel_id, uid, device_id_hash, created_at)
      VALUES (?, 'dm', 'room-one', ?, ?, ?)
    `).run(root.id, `private-actor-${index}`, `private-device-${index}`, root.createdAt);
    source.prepare(`
      INSERT INTO dm_notification_owners (dm_id, channel_id, user_id, created_at)
      VALUES (?, 'room-one', ?, ?)
    `).run(root.id, `private-user-${index}`, root.createdAt);
  }
  insertDm(destination, 0, "stale-text");
  insertDm(destination, 99, "hard-deleted-root");
  insertReply(destination, "dm-099", 99);

  const inputEnv = env(source, destination);
  let stage = "delta_dm_roots_upserting";
  for (let call = 0; call < 20 && stage !== "delta_dm_dependents_copied"; call += 1) {
    const response = await handleCanaryMessageDelta(request("reconcile-dm"), inputEnv);
    assert.equal(response.status, 200);
    const body = await response.json() as { stage: string };
    assert.doesNotMatch(JSON.stringify(body), /private-|stale-text|hard-deleted/);
    stage = body.stage;
  }
  assert.equal(stage, "delta_dm_dependents_copied");
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM dm").get()?.count, 45);
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM dm_replies").get()?.count, 42);
  assert.equal(
    destination.prepare("SELECT text FROM dm WHERE id = 'dm-000'").get()?.text,
    "private-dm-0",
  );
  assert.equal(
    destination.prepare("SELECT COUNT(*) AS count FROM message_actor_identities").get()?.count,
    45,
  );
  assert.equal(
    destination.prepare("SELECT COUNT(*) AS count FROM dm_notification_owners").get()?.count,
    45,
  );

  const completed = await handleCanaryMessageDelta(request("complete-dm"), inputEnv);
  assert.equal(completed.status, 200);
  const completedBody = await completed.json() as { status: string; stage: string };
  assert.deepEqual(completedBody, {
    shardId: "canary-a",
    channelId: "room-one",
    stage: "delta_dm_verified",
    status: "active",
    idempotent: false,
    blockers: [],
  });
  assert.equal(
    destination.prepare("SELECT COUNT(*) AS count FROM canary_dm_reconciliation_seen").get()?.count,
    0,
  );
});

test("DM completion detects derived activity drift without exposing rows", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  const root = insertDm(source, 0);
  insertReply(source, root.id, 0);
  insertDm(destination, 0);
  insertReply(destination, root.id, 0);
  destination.prepare("UPDATE dm SET activity_at = '2000-01-01' WHERE id = ?").run(root.id);
  destination.prepare(`
    UPDATE canary_channel_copy_jobs SET stage = 'delta_dm_dependents_copied'
  `).run();

  const response = await handleCanaryMessageDelta(
    request("complete-dm"),
    env(source, destination),
  );
  assert.equal(response.status, 409);
  const body = await response.json() as { blockers: string[] };
  assert.deepEqual(body.blockers, ["dm_activity_mismatch"]);
  assert.doesNotMatch(JSON.stringify(body), /private-|2000-01-01/);
});
