import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  applyChannelReportProjectionEvent,
  parseChannelReportProjectionEvent,
  type ChannelReportProjectionEventRow,
} from "../src/lib/channel-report-projection.ts";

const migration = readFileSync(
  new URL("../migrations/0069_channel_report_control_projections.sql", import.meta.url),
  "utf8",
);
const eventMigration = readFileSync(
  new URL("../migrations/0070_channel_report_projection_events.sql", import.meta.url),
  "utf8",
);

function eventRow(
  overrides: Partial<ChannelReportProjectionEventRow> = {},
): ChannelReportProjectionEventRow {
  return {
    id: "event-1",
    channel_id: "room-one",
    aggregate_type: "channel_report",
    aggregate_id: "report-1",
    event_type: "channel_report_projection_upsert",
    source_version: 2,
    payload_json: JSON.stringify({
      channel_name: "Room One",
      channel_owner_uid: "private-owner",
      reporter_uid: "private-reporter",
      reporter_auth_uid: null,
      reporter_device_id: "private-device",
      reason: "spam",
      details: "private-details",
      created_at: "2026-09-14T00:00:00.000Z",
      status: "open",
      resolution_note: null,
      resolved_at: null,
      inbox_message_id: "inbox-1",
      state: "active",
    }),
    ...overrides,
  };
}

class Statement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
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
    return new Statement(this.database, this.sql, values);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class Database {
  readonly sqlite = new DatabaseSync(":memory:");

  prepare(sql: string) {
    return new Statement(this.sqlite, sql);
  }

  async batch(statements: Statement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function createControlDatabase() {
  const database = new Database();
  database.sqlite.exec(`
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
  `);
  return database;
}

test("report projection migration backfills existing reports without account foreign keys", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_uid TEXT NOT NULL
    );
    CREATE TABLE channel_reports (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      reporter_uid TEXT NOT NULL,
      reporter_auth_uid TEXT,
      reporter_device_id TEXT,
      reason TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      resolution_note TEXT,
      resolved_at TEXT,
      inbox_message_id TEXT
    );
    INSERT INTO channels VALUES ('room-one', 'Room One', 'private-owner');
    INSERT INTO channel_reports (
      id, channel_id, reporter_uid, reporter_auth_uid, reporter_device_id,
      reason, details, created_at, status, inbox_message_id
    ) VALUES (
      'report-1', 'room-one', 'private-reporter', NULL, 'private-device',
      'spam', 'private-details', '2026-09-14T00:00:00.000Z', 'open', 'inbox-1'
    );
  `);
  database.exec(migration);

  const projection = database.prepare(`
    SELECT report_id, channel_id, channel_name, channel_owner_uid,
      source_version, status
    FROM channel_report_control_projections
  `).get();
  assert.deepEqual({ ...projection }, {
    report_id: "report-1",
    channel_id: "room-one",
    channel_name: "Room One",
    channel_owner_uid: "private-owner",
    source_version: 1,
    status: "open",
  });
  assert.deepEqual({ ...database.prepare(`
    SELECT report_id, source_version, state
    FROM channel_report_projection_watermarks
  `).get() }, {
    report_id: "report-1",
    source_version: 1,
    state: "active",
  });
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS count
      FROM pragma_foreign_key_list('channel_report_control_projections')
    `).get()?.count,
    0,
  );
});

test("report mutations atomically advance projections and durable events", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
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
      status TEXT NOT NULL DEFAULT 'open',
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
      source_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      next_attempt_at TEXT NOT NULL,
      lease_until TEXT,
      last_error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(channel_id, event_type, aggregate_id, source_version)
    );
    INSERT INTO channels VALUES ('room-one', 'Room One', 'private-owner');
  `);
  database.exec(migration);
  database.exec(eventMigration);

  database.prepare(`
    INSERT INTO channel_reports (
      id, channel_id, reporter_uid, reporter_device_id, reason, details,
      created_at, status, inbox_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "report-1",
    "room-one",
    "private-reporter",
    "private-device",
    "spam",
    "private-details",
    "2026-09-14T00:00:00.000Z",
    "open",
    "inbox-1",
  );
  assert.deepEqual({ ...database.prepare(`
    SELECT source_version, status FROM channel_report_control_projections
    WHERE report_id = 'report-1'
  `).get() }, { source_version: 1, status: "open" });

  database.prepare(`
    UPDATE channel_reports
    SET status = 'resolved', resolution_note = 'handled',
      resolved_at = '2026-09-14T01:00:00.000Z'
    WHERE id = 'report-1'
  `).run();
  assert.deepEqual({ ...database.prepare(`
    SELECT projection_source_version, status
    FROM channel_reports WHERE id = 'report-1'
  `).get() }, { projection_source_version: 2, status: "resolved" });
  assert.deepEqual({ ...database.prepare(`
    SELECT source_version, status FROM channel_report_control_projections
    WHERE report_id = 'report-1'
  `).get() }, { source_version: 2, status: "resolved" });

  database.prepare("DELETE FROM channel_reports WHERE id = 'report-1'").run();
  assert.equal(
    database.prepare(`
      SELECT report_id FROM channel_report_control_projections
      WHERE report_id = 'report-1'
    `).get(),
    undefined,
  );
  assert.deepEqual({ ...database.prepare(`
    SELECT source_version, state FROM channel_report_projection_watermarks
    WHERE report_id = 'report-1'
  `).get() }, { source_version: 3, state: "deleted" });
  assert.deepEqual(
    database.prepare(`
      SELECT event_type, source_version
      FROM domain_events
      WHERE aggregate_id = 'report-1'
      ORDER BY source_version
    `).all().map((row) => ({ ...row })),
    [
      { event_type: "channel_report_projection_upsert", source_version: 1 },
      { event_type: "channel_report_projection_upsert", source_version: 2 },
      { event_type: "channel_report_projection_delete", source_version: 3 },
    ],
  );
});

test("report event parser accepts only the strict bounded payload", () => {
  const parsed = parseChannelReportProjectionEvent(eventRow());
  assert.ok(parsed && parsed.type === "upsert");
  assert.equal(parsed.reportId, "report-1");
  assert.equal(parsed.details, "private-details");

  assert.equal(parseChannelReportProjectionEvent(eventRow({
    aggregate_type: "channel",
  })), null);
  assert.equal(parseChannelReportProjectionEvent(eventRow({
    payload_json: JSON.stringify({ state: "active" }),
  })), null);
  assert.equal(parseChannelReportProjectionEvent(eventRow({
    payload_json: JSON.stringify({
      ...JSON.parse(eventRow().payload_json),
      details: "x".repeat(501),
    }),
  })), null);
  assert.equal(parseChannelReportProjectionEvent(eventRow({
    event_type: "channel_report_projection_delete",
    payload_json: JSON.stringify({ state: "deleted", details: "leak" }),
  })), null);
});

test("report projection watermark prevents stale resurrection", async () => {
  const control = createControlDatabase();
  const database = control as unknown as D1Database;
  const now = "2026-09-14T00:01:00.000Z";
  const initial = parseChannelReportProjectionEvent(eventRow({ source_version: 1 }));
  assert.ok(initial);
  await applyChannelReportProjectionEvent(database, initial, now);

  const deleted = parseChannelReportProjectionEvent(eventRow({
    id: "event-3",
    source_version: 3,
    event_type: "channel_report_projection_delete",
    payload_json: JSON.stringify({ state: "deleted" }),
  }));
  assert.ok(deleted);
  await applyChannelReportProjectionEvent(database, deleted, now);

  const stale = parseChannelReportProjectionEvent(eventRow({
    id: "event-2",
    source_version: 2,
  }));
  assert.ok(stale);
  await applyChannelReportProjectionEvent(database, stale, now);

  assert.equal(
    control.sqlite.prepare(`
      SELECT report_id FROM channel_report_control_projections WHERE report_id = 'report-1'
    `).get(),
    undefined,
  );
  assert.deepEqual({ ...control.sqlite.prepare(`
    SELECT source_version, state
    FROM channel_report_projection_watermarks
    WHERE report_id = 'report-1'
  `).get() }, { source_version: 3, state: "deleted" });
});
