import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleCanaryProjectionDispatchOnce } from "../src/routes/canary-projection-dispatch-once.ts";
import type { Env } from "../src/types.ts";

const DISPATCH_TOKEN = "dispatch-token-that-is-at-least-thirty-two-characters";

class SqliteStatement {
  private readonly database: DatabaseSync;
  readonly sql: string;
  readonly values: unknown[];

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

  executeForBatch() {
    if (/^\s*SELECT\b/i.test(this.sql)) {
      return {
        results: this.database.prepare(this.sql).all(...this.values),
        meta: { changes: 0 },
      };
    }
    const result = this.database.prepare(this.sql).run(...this.values);
    return { results: [], meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1 {
  readonly database: DatabaseSync;
  failNextBatch = false;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  prepare(sql: string) {
    return new SqliteStatement(this.database, sql);
  }

  async batch(statements: SqliteStatement[]) {
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error("simulated control failure containing private text");
    }
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.executeForBatch());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createSourceDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_uid TEXT NOT NULL
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
      inbox_message_id TEXT
    );
    CREATE TABLE domain_events (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_version INTEGER NOT NULL CHECK (source_version > 0),
      payload_json TEXT NOT NULL
        CHECK (json_valid(payload_json) AND length(payload_json) <= 16384),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'delivered', 'dead')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at TEXT NOT NULL,
      lease_until TEXT,
      last_error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(channel_id, event_type, aggregate_id, source_version)
    );
    CREATE INDEX domain_events_attempt_ready_idx
      ON domain_events(status, next_attempt_at, created_at, id);
    CREATE INDEX domain_events_lease_ready_idx
      ON domain_events(status, lease_until, created_at, id);
  `);
  database.exec(readFileSync(
    new URL("../migrations/0069_channel_report_control_projections.sql", import.meta.url),
    "utf8",
  ));
  database.exec(readFileSync(
    new URL("../migrations/0070_channel_report_projection_events.sql", import.meta.url),
    "utf8",
  ));
  return new SqliteD1(database);
}

function createControlDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
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
      source_version INTEGER NOT NULL CHECK (source_version > 0),
      projected_at TEXT NOT NULL
    );
    CREATE TABLE channel_report_projection_watermarks (
      report_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      source_version INTEGER NOT NULL CHECK (source_version > 0),
      state TEXT NOT NULL CHECK (state IN ('active', 'deleted')),
      updated_at TEXT NOT NULL
    );
  `);
  return new SqliteD1(database);
}

function createFixture() {
  const source = createSourceDatabase();
  const control = createControlDatabase();
  source.database.exec(`
    INSERT INTO channels (id, name, owner_uid)
    VALUES ('room-one', 'Room One', 'owner-one'),
           ('room-two', 'Room Two', 'owner-two');
  `);
  const env = {
    DB: control as unknown as D1Database,
    CHAT_DB_CANARY_A: source as unknown as D1Database,
    D1_CANARY_DISPATCH_TOKEN: DISPATCH_TOKEN,
    WRITE_MAINTENANCE_MODE: "true",
  } as Env;
  return { source, control, env };
}

function dispatchRequest(channel = "room-one", token = DISPATCH_TOKEN) {
  return new Request("https://worker.test/internal/d1-canary/dispatch-once", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Canary-Dispatch-Token": token,
    },
    body: JSON.stringify({
      action: "dispatch-channel-reports",
      shard: "canary-a",
      channel,
    }),
  });
}

function insertReport(source: SqliteD1, id: string, channelId: string) {
  source.database.prepare(`
    INSERT INTO channel_reports (
      id, channel_id, reporter_uid, reporter_auth_uid, reporter_device_id,
      reason, details, created_at, status, resolution_note, resolved_at,
      inbox_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, ?)
  `).run(
    id,
    channelId,
    `reporter-${id}`,
    `account-${id}`,
    `device-${id}`,
    "spam",
    `private-details-${id}`,
    "2026-09-14T00:00:00.000Z",
    `inbox-${id}`,
  );
}

test("one-shot report dispatch projects create, update, and delete in version order", async () => {
  const { source, control, env } = createFixture();
  insertReport(source, "report-one", "room-one");

  const created = await handleCanaryProjectionDispatchOnce(dispatchRequest(), env);
  assert.equal(created.status, 200);
  assert.deepEqual((await created.json()).result, {
    claimed: 1,
    delivered: 1,
    retried: 0,
    dead: 0,
  });
  assert.deepEqual({ ...control.database.prepare(`
    SELECT channel_id, status, source_version
    FROM channel_report_control_projections
    WHERE report_id = 'report-one'
  `).get() }, { channel_id: "room-one", status: "open", source_version: 1 });

  source.database.exec(`
    UPDATE channel_reports
    SET status = 'resolved', resolution_note = 'handled',
        resolved_at = '2026-09-14T00:05:00.000Z'
    WHERE id = 'report-one';
  `);
  const updated = await handleCanaryProjectionDispatchOnce(dispatchRequest(), env);
  assert.equal(updated.status, 200);
  assert.deepEqual({ ...control.database.prepare(`
    SELECT status, resolution_note, source_version
    FROM channel_report_control_projections
    WHERE report_id = 'report-one'
  `).get() }, {
    status: "resolved",
    resolution_note: "handled",
    source_version: 2,
  });

  source.database.exec("DELETE FROM channel_reports WHERE id = 'report-one'");
  const deleted = await handleCanaryProjectionDispatchOnce(dispatchRequest(), env);
  assert.equal(deleted.status, 200);
  assert.equal(control.database.prepare(`
    SELECT 1 FROM channel_report_control_projections WHERE report_id = 'report-one'
  `).get(), undefined);
  assert.deepEqual({ ...control.database.prepare(`
    SELECT source_version, state
    FROM channel_report_projection_watermarks
    WHERE report_id = 'report-one'
  `).get() }, { source_version: 3, state: "deleted" });
});

test("one-shot dispatch cannot claim another channel or another aggregate type", async () => {
  const { source, control, env } = createFixture();
  insertReport(source, "report-one", "room-one");
  insertReport(source, "report-two", "room-two");
  source.database.prepare(`
    INSERT INTO domain_events (
      id, channel_id, aggregate_type, aggregate_id, event_type, source_version,
      payload_json, status, attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'channel-event', 'room-one', 'channel', 'room-one',
      'channel_projection_delete', 1, '{"state":"deleted"}', 'pending', 0,
      '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z',
      '2020-01-01T00:00:00.000Z'
    )
  `).run();

  const response = await handleCanaryProjectionDispatchOnce(dispatchRequest(), env);
  assert.equal(response.status, 200);
  assert.equal(control.database.prepare(`
    SELECT 1 FROM channel_report_control_projections WHERE report_id = 'report-two'
  `).get(), undefined);
  assert.equal(source.database.prepare(`
    SELECT status FROM domain_events
    WHERE aggregate_id = 'report-two' AND aggregate_type = 'channel_report'
  `).get()?.status, "pending");
  assert.equal(source.database.prepare(`
    SELECT status FROM domain_events WHERE id = 'channel-event'
  `).get()?.status, "pending");
});

test("control failure retries without leaking content and a later one-shot succeeds", async () => {
  const { source, control, env } = createFixture();
  insertReport(source, "report-one", "room-one");
  control.failNextBatch = true;

  const failed = await handleCanaryProjectionDispatchOnce(dispatchRequest(), env);
  const failedText = await failed.text();
  assert.equal(failed.status, 200);
  assert.match(failedText, /"retried":1/);
  assert.doesNotMatch(failedText, /private-details|simulated control failure/);
  assert.deepEqual({ ...source.database.prepare(`
    SELECT status, attempt_count, last_error_code
    FROM domain_events
    WHERE aggregate_id = 'report-one' AND aggregate_type = 'channel_report'
  `).get() }, {
    status: "pending",
    attempt_count: 1,
    last_error_code: "projection_control_write_failed",
  });

  source.database.exec(`
    UPDATE domain_events
    SET next_attempt_at = '2020-01-01T00:00:00.000Z'
    WHERE aggregate_id = 'report-one' AND aggregate_type = 'channel_report';
  `);
  const retried = await handleCanaryProjectionDispatchOnce(dispatchRequest(), env);
  assert.equal(retried.status, 200);
  assert.equal(control.database.prepare(`
    SELECT source_version FROM channel_report_control_projections
    WHERE report_id = 'report-one'
  `).get()?.source_version, 1);
});

test("invalid report event is dead-lettered and operator prerequisites fail closed", async () => {
  const { source, env } = createFixture();
  source.database.prepare(`
    INSERT INTO domain_events (
      id, channel_id, aggregate_type, aggregate_id, event_type, source_version,
      payload_json, status, attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'invalid-report-event', 'room-one', 'channel_report', 'report-bad',
      'channel_report_projection_upsert', 1,
      '{"state":"active","secret":"must-not-leak"}', 'pending', 0,
      '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z',
      '2020-01-01T00:00:00.000Z'
    )
  `).run();

  const invalid = await handleCanaryProjectionDispatchOnce(dispatchRequest(), env);
  const invalidText = await invalid.text();
  assert.equal(invalid.status, 200);
  assert.match(invalidText, /"dead":1/);
  assert.doesNotMatch(invalidText, /must-not-leak/);
  assert.deepEqual({ ...source.database.prepare(`
    SELECT status, last_error_code FROM domain_events
    WHERE id = 'invalid-report-event'
  `).get() }, {
    status: "dead",
    last_error_code: "invalid_channel_report_projection_event",
  });

  const unauthorized = await handleCanaryProjectionDispatchOnce(
    dispatchRequest("room-one", "wrong-token"),
    env,
  );
  assert.equal(unauthorized.status, 404);

  const noMaintenance = { ...env, WRITE_MAINTENANCE_MODE: "false" } as Env;
  assert.equal(
    (await handleCanaryProjectionDispatchOnce(dispatchRequest(), noMaintenance)).status,
    409,
  );

  const scheduled = {
    ...env,
    D1_CANARY_PROJECTION_DISPATCH_ENABLED: "true",
  } as Env;
  assert.equal(
    (await handleCanaryProjectionDispatchOnce(dispatchRequest(), scheduled)).status,
    409,
  );
});

test("one-shot dispatch has no production secret or browser proxy contract", () => {
  const productionConfig = readFileSync(
    new URL("../wrangler.toml", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(
    new URL("../src/routes/canary-projection-dispatch-once.ts", import.meta.url),
    "utf8",
  );
  const indexSource = readFileSync(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(productionConfig, /D1_CANARY_DISPATCH_TOKEN/);
  assert.doesNotMatch(productionConfig, /CHAT_DB_CANARY_[AB]/);
  assert.match(indexSource, /\/internal\/d1-canary\/dispatch-once/);
  assert.doesNotMatch(routeSource, /Access-Control-Allow-Origin/i);
  assert.doesNotMatch(routeSource, /INTERNAL_SECRET/);
});
