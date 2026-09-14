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

  constructor(database: DatabaseSync, sql: string, values: unknown[] = []) {
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
      name TEXT NOT NULL,
      owner_uid TEXT NOT NULL,
      projection_source_version INTEGER NOT NULL
    );
    CREATE TABLE channel_reports (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      reporter_uid TEXT NOT NULL,
      reporter_auth_uid TEXT,
      reporter_device_id TEXT,
      reason TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      resolution_note TEXT,
      resolved_at TEXT,
      inbox_message_id TEXT,
      projection_source_version INTEGER NOT NULL
    );
    CREATE TABLE channel_report_control_projections (
      report_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      channel_owner_uid TEXT NOT NULL,
      reporter_uid TEXT NOT NULL,
      reporter_auth_uid TEXT,
      reporter_device_id TEXT,
      reason TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      resolution_note TEXT,
      resolved_at TEXT,
      inbox_message_id TEXT,
      source_version INTEGER NOT NULL,
      projected_at TEXT NOT NULL
    );
    CREATE TABLE channel_report_projection_watermarks (
      report_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      source_version INTEGER NOT NULL,
      state TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE domain_events (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      next_attempt_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE pending_admin_deletions (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL);
    INSERT INTO channels VALUES
      ('room-one', 'Room One', 'private-owner', 7),
      ('room-one_live', 'Room One Live', 'private-owner', 7);
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
      CREATE TABLE canary_channel_report_reconciliation_seen (
        channel_id TEXT NOT NULL,
        report_id TEXT NOT NULL,
        PRIMARY KEY (channel_id, report_id)
      );
      INSERT INTO canary_channel_copy_jobs (
        channel_id, source_projection_version, stage, status, created_at, updated_at
      ) VALUES (
        'room-one', 7, 'delta_notification_manifest_verified', 'active',
        '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z'
      );

      CREATE TRIGGER channel_report_projection_insert
      AFTER INSERT ON channel_reports
      BEGIN
        INSERT INTO channel_report_projection_watermarks (
          report_id, channel_id, source_version, state, updated_at
        ) VALUES (
          NEW.id, NEW.channel_id, NEW.projection_source_version, 'active',
          '2026-09-14T00:00:00.000Z'
        );
        INSERT INTO domain_events (
          id, channel_id, aggregate_type, aggregate_id, event_type,
          source_version, payload_json, status, attempt_count, next_attempt_at,
          created_at, updated_at
        ) VALUES (
          'event-' || NEW.id, NEW.channel_id, 'channel_report', NEW.id,
          'channel_report_projection_upsert', NEW.projection_source_version,
          '{}', 'pending', 0, '2026-09-14T00:00:00.000Z',
          '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z'
        );
      END;
    `);
  }
  return database;
}

function insertSourceReport(database: DatabaseSync, index: number, version = 1) {
  const id = `report-${String(index).padStart(3, "0")}`;
  const createdAt = `2026-09-14T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`;
  database.prepare(`
    INSERT INTO channel_reports (
      id, channel_id, reporter_uid, reporter_auth_uid, reporter_device_id,
      reason, details, created_at, status, resolution_note, resolved_at,
      inbox_message_id, projection_source_version
    ) VALUES (?, 'room-one', ?, NULL, ?, 'spam', ?, ?, 'open', NULL, NULL, ?, ?)
  `).run(
    id,
    `private-reporter-${index}`,
    `private-device-${index}`,
    `private-details-${index}`,
    createdAt,
    `private-inbox-${index}`,
    version,
  );
  database.prepare(`
    INSERT INTO channel_report_projection_watermarks
    VALUES (?, 'room-one', ?, 'active', '2026-09-14T00:00:00.000Z')
  `).run(id, version);
  database.prepare(`
    INSERT INTO channel_report_control_projections VALUES (
      ?, 'room-one', 'Room One', 'private-owner', ?, NULL, ?, 'spam', ?, ?,
      'open', NULL, NULL, ?, ?, '2026-09-14T00:00:00.000Z'
    )
  `).run(
    id,
    `private-reporter-${index}`,
    `private-device-${index}`,
    `private-details-${index}`,
    createdAt,
    `private-inbox-${index}`,
    version,
  );
  return id;
}

function env(source: DatabaseSync, destination: DatabaseSync): Env {
  return {
    DB: new SqliteD1(source) as unknown as D1Database,
    CHAT_DB_CANARY_A: new SqliteD1(destination) as unknown as D1Database,
    D1_CANARY_FINALIZE_TOKEN: FINALIZE_TOKEN,
    WRITE_MAINTENANCE_MODE: "true",
  } as unknown as Env;
}

function request(action: "reconcile-channel-reports" | "complete-channel-reports") {
  return new Request("https://worker.example/internal/d1-canary/message-delta", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Canary-Finalize-Token": FINALIZE_TOKEN,
    },
    body: JSON.stringify({ action, shard: "canary-a", channel: "room-one" }),
  });
}

test("frozen channel reports copy in bounded idempotent batches and verify projections", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  for (let index = 0; index < 45; index += 1) insertSourceReport(source, index, index % 3 + 1);

  const inputEnv = env(source, destination);
  let stage = "delta_notification_manifest_verified";
  const batchSizes: number[] = [];
  for (let call = 0; call < 10 && stage !== "delta_channel_reports_copied"; call += 1) {
    const response = await handleCanaryMessageDelta(request("reconcile-channel-reports"), inputEnv);
    assert.equal(response.status, 200);
    const body = await response.json() as { stage: string; batchRowsCopied?: number };
    assert.doesNotMatch(JSON.stringify(body), /private-/);
    if (body.batchRowsCopied !== undefined) batchSizes.push(body.batchRowsCopied);
    stage = body.stage;
  }
  assert.equal(stage, "delta_channel_reports_copied");
  assert.ok(batchSizes.every((size) => size <= 40));
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM channel_reports").get()?.count, 45);
  assert.equal(destination.prepare("SELECT COUNT(*) AS count FROM domain_events").get()?.count, 45);
  assert.equal(
    destination.prepare("SELECT COUNT(*) AS count FROM channel_report_control_projections").get()?.count,
    0,
  );

  const completed = await handleCanaryMessageDelta(request("complete-channel-reports"), inputEnv);
  assert.equal(completed.status, 200);
  assert.deepEqual(await completed.json(), {
    shardId: "canary-a",
    channelId: "room-one",
    stage: "delta_channel_reports_verified",
    status: "active",
    idempotent: false,
    blockers: [],
  });
  assert.equal(
    destination.prepare("SELECT COUNT(*) AS count FROM canary_channel_report_reconciliation_seen").get()?.count,
    0,
  );
});

test("report copy fails closed instead of overwriting a conflicting destination row", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  const id = insertSourceReport(source, 1);
  destination.prepare(`
    INSERT INTO channel_reports (
      id, channel_id, reporter_uid, reason, details, created_at, status,
      projection_source_version
    ) VALUES (?, 'room-one', 'conflicting-private-reporter', 'spam', NULL,
      '2026-09-14T00:01:00.000Z', 'open', 1)
  `).run(id);

  const response = await handleCanaryMessageDelta(
    request("reconcile-channel-reports"),
    env(source, destination),
  );
  assert.equal(response.status, 409);
  const body = await response.json() as { status: string; blockers: string[] };
  assert.equal(body.status, "failed");
  assert.deepEqual(body.blockers, ["channel_report_destination_conflict"]);
  assert.doesNotMatch(JSON.stringify(body), /conflicting-private/);
});

test("report completion detects a stale source control projection without leaking it", async () => {
  const source = createDatabase();
  const destination = createDatabase(true);
  insertSourceReport(source, 1);
  const inputEnv = env(source, destination);

  await handleCanaryMessageDelta(request("reconcile-channel-reports"), inputEnv);
  await handleCanaryMessageDelta(request("reconcile-channel-reports"), inputEnv);
  source.prepare(`
    UPDATE channel_report_control_projections
    SET details = 'stale-private-projection'
  `).run();

  const completed = await handleCanaryMessageDelta(
    request("complete-channel-reports"),
    inputEnv,
  );
  assert.equal(completed.status, 409);
  const body = await completed.json() as { blockers: string[] };
  assert.deepEqual(body.blockers, ["source_channel_report_projection_mismatch"]);
  assert.doesNotMatch(JSON.stringify(body), /stale-private/);
});
