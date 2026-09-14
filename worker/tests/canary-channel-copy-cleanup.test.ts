import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleCanaryChannelCopyCleanup } from "../src/routes/canary-channel-copy-cleanup.ts";
import type { Env } from "../src/types.ts";

const CLEANUP_TOKEN = "cleanup-token-that-is-at-least-thirty-two-characters";

class SqliteStatement {
  readonly database: DatabaseSync;
  readonly sql: string;
  readonly values: unknown[];

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

function createDestination(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      projection_source_version INTEGER NOT NULL
    );
    CREATE TABLE canary_channel_copy_jobs (
      channel_id TEXT PRIMARY KEY,
      source_projection_version INTEGER NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE canary_channel_cleanup_audit (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      source_projection_version INTEGER NOT NULL,
      previous_stage TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      cleaned_at TEXT NOT NULL
    );
    CREATE TABLE canary_message_reconciliation_seen (
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY (channel_id, message_id)
    );
    CREATE TABLE canary_dm_reconciliation_seen (
      channel_id TEXT NOT NULL,
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      PRIMARY KEY (channel_id, record_type, record_id)
    );
    CREATE TABLE channel_control_projections (channel_id TEXT PRIMARY KEY);
    CREATE TABLE channel_projection_versions (
      channel_id TEXT PRIMARY KEY,
      source_version INTEGER NOT NULL,
      state TEXT NOT NULL
    );
    CREATE TABLE domain_events (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      reply_to TEXT REFERENCES messages(id) ON DELETE SET NULL
    );
    CREATE TABLE message_actor_identities (
      record_id TEXT NOT NULL,
      record_type TEXT NOT NULL,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      PRIMARY KEY (record_id, record_type)
    );
    CREATE TABLE message_links (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL
    );
    CREATE TABLE gallery (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id)
    );
    CREATE TABLE upload_tickets (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE
    );
    CREATE TABLE config (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL);
    CREATE TABLE channel_petitions (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE
    );
    CREATE TABLE channel_moderation (
      channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE
    );
    CREATE TABLE banned_words (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE
    );
    CREATE TABLE blocked (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id)
    );
    CREATE TABLE moderators (
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      uid TEXT NOT NULL,
      PRIMARY KEY (channel_id, uid)
    );
    CREATE TABLE dm (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL);
    CREATE TABLE dm_replies (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL);
    CREATE TABLE channel_reports (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL);
    CREATE TABLE pending_admin_deletions (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL);
    CREATE TABLE notification_preferences (user_id TEXT, channel_id TEXT NOT NULL);
    CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL);
    CREATE TABLE notification_outbox (id TEXT PRIMARY KEY, channel_id TEXT);
    CREATE TABLE message_notification_owners (message_id TEXT, channel_id TEXT NOT NULL);
    CREATE TABLE dm_notification_owners (dm_id TEXT, channel_id TEXT NOT NULL);
    CREATE TABLE user_recent_channels (user_id TEXT, channel_id TEXT NOT NULL);
    CREATE TABLE cleanup_jobs (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL
    );

    CREATE TRIGGER channel_insert AFTER INSERT ON channels
    WHEN NEW.id NOT LIKE '%_live'
    BEGIN
      INSERT INTO channel_projection_versions (channel_id, source_version, state)
      VALUES (NEW.id, NEW.projection_source_version, 'active');
      INSERT INTO domain_events (id, channel_id, status)
      VALUES ('insert-' || NEW.id, NEW.id, 'pending');
    END;
    CREATE TRIGGER channel_delete AFTER DELETE ON channels
    WHEN OLD.id NOT LIKE '%_live'
    BEGIN
      UPDATE channel_projection_versions
      SET source_version = source_version + 1, state = 'deleted'
      WHERE channel_id = OLD.id;
      INSERT INTO domain_events (id, channel_id, status)
      VALUES ('delete-' || OLD.id, OLD.id, 'pending');
    END;
  `);
  database.exec(`
    INSERT INTO channels VALUES ('room-one', 7);
    INSERT INTO channels VALUES ('room-one_live', 7);
    INSERT INTO messages VALUES ('message-one', 'room-one', NULL);
    INSERT INTO message_actor_identities
      VALUES ('message-one', 'message', 'room-one');
    INSERT INTO message_links VALUES ('message-one', 'room-one');
    INSERT INTO gallery VALUES ('gallery-one', 'room-one');
    INSERT INTO config VALUES ('config-one', 'room-one');
    INSERT INTO blocked VALUES ('blocked-one', 'room-one');
    INSERT INTO canary_channel_copy_jobs
      VALUES ('room-one', 7, 'messages_copied', 'active', '2026-09-13T00:00:00Z');
    INSERT INTO canary_message_reconciliation_seen VALUES ('room-one', 'message-one');
  `);
  return database;
}

function env(destination: DatabaseSync, overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    CHAT_DB_CANARY_A: new SqliteD1(destination) as unknown as D1Database,
    D1_CANARY_CLEANUP_TOKEN: CLEANUP_TOKEN,
    ...overrides,
  } as Env;
}

function request(
  action: "abandon" | "cleanup",
  sourceProjectionVersion = 7,
  token = CLEANUP_TOKEN,
) {
  return new Request("https://worker.example/internal/d1-canary/copy-cleanup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Canary-Cleanup-Token": token,
    },
    body: JSON.stringify({
      action,
      shard: "canary-a",
      channel: "room-one",
      sourceProjectionVersion,
    }),
  });
}

test("cleanup requires explicit abandon and removes one canary copy atomically", async () => {
  const destination = createDestination();
  const inputEnv = env(destination);

  const premature = await handleCanaryChannelCopyCleanup(
    request("cleanup"),
    inputEnv,
  );
  assert.equal(premature.status, 409);
  assert.deepEqual(
    (await premature.json() as { blockers: string[] }).blockers,
    ["cleanup_requires_failed_or_abandoned_job"],
  );

  const abandoned = await handleCanaryChannelCopyCleanup(
    request("abandon"),
    inputEnv,
  );
  assert.equal(abandoned.status, 200);
  assert.equal((await abandoned.json() as { status: string }).status, "abandoned");

  const cleaned = await handleCanaryChannelCopyCleanup(
    request("cleanup"),
    inputEnv,
  );
  assert.equal(cleaned.status, 200);
  assert.equal((await cleaned.json() as { status: string }).status, "cleaned");
  for (const table of [
    "channels",
    "messages",
    "message_actor_identities",
    "message_links",
    "gallery",
    "config",
    "blocked",
    "domain_events",
    "channel_projection_versions",
    "canary_channel_copy_jobs",
    "canary_message_reconciliation_seen",
    "canary_dm_reconciliation_seen",
  ]) {
    assert.equal(
      destination.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count,
      0,
      table,
    );
  }
  assert.equal(
    destination.prepare("SELECT COUNT(*) AS count FROM canary_channel_cleanup_audit")
      .get()?.count,
    1,
  );

  const retry = await handleCanaryChannelCopyCleanup(request("cleanup"), inputEnv);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { idempotent: boolean }).idempotent, true);
});

test("cleanup fails closed for shadowed, processed, or unsupported state", async () => {
  const shadowed = createDestination();
  shadowed.prepare(`
    UPDATE canary_channel_copy_jobs SET status = 'abandoned'
  `).run();
  const shadowResponse = await handleCanaryChannelCopyCleanup(
    request("cleanup"),
    env(shadowed, { D1_CANARY_SHADOW_CHANNELS: "canary-a:room-one" }),
  );
  assert.equal(shadowResponse.status, 409);
  assert.deepEqual(
    (await shadowResponse.json() as { blockers: string[] }).blockers,
    ["channel_shadow_active"],
  );

  const unsafe = createDestination();
  unsafe.prepare("UPDATE canary_channel_copy_jobs SET status = 'abandoned'").run();
  unsafe.prepare("UPDATE domain_events SET status = 'delivered'").run();
  unsafe.prepare("INSERT INTO channel_reports VALUES ('report-one', 'room-one')").run();
  const unsafeResponse = await handleCanaryChannelCopyCleanup(
    request("cleanup"),
    env(unsafe),
  );
  assert.equal(unsafeResponse.status, 409);
  assert.deepEqual(
    (await unsafeResponse.json() as { blockers: string[] }).blockers,
    ["projection_event_already_processed", "unsupported_channel_state_present"],
  );
  assert.equal(unsafe.prepare("SELECT COUNT(*) AS count FROM channels").get()?.count, 2);
});

test("cleanup has a distinct hidden secret and rejects active dispatch", async () => {
  const destination = createDestination();
  assert.equal(
    (await handleCanaryChannelCopyCleanup(
      request("abandon", 7, "wrong-token-that-is-still-at-least-thirty-two"),
      env(destination),
    )).status,
    404,
  );
  assert.equal(
    (await handleCanaryChannelCopyCleanup(
      request("abandon"),
      env(destination, { D1_CANARY_PROJECTION_DISPATCH_ENABLED: "true" }),
    )).status,
    409,
  );
  assert.equal(
    (await handleCanaryChannelCopyCleanup(request("abandon", 8), env(destination)))
      .status,
    409,
  );

  const routeSource = readFileSync(
    new URL("../src/routes/canary-channel-copy-cleanup.ts", import.meta.url),
    "utf8",
  );
  const indexSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const productionWrangler = readFileSync(
    new URL("../wrangler.toml", import.meta.url),
    "utf8",
  );
  const cleanupSource = readFileSync(
    new URL("../src/lib/canary-channel-copy-cleanup.ts", import.meta.url),
    "utf8",
  );
  assert.match(indexSource, /\/internal\/d1-canary\/copy-cleanup/);
  assert.doesNotMatch(
    indexSource,
    /Access-Control-Allow-Headers[^\n]*X-Canary-Cleanup-Token/,
  );
  assert.doesNotMatch(routeSource, /X-Internal-Token|X-User-Id/);
  assert.doesNotMatch(productionWrangler, /D1_CANARY_CLEANUP_TOKEN/);
  assert.doesNotMatch(cleanupSource, /push_subscriptions\s+WHERE\s+channel_id/);
});
