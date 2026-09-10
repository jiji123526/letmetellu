import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  applyChannelProjectionEvent,
  drainChannelProjectionEvents,
  parseChannelProjectionEvent,
} from "../src/lib/channel-projection-consumer.ts";

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    channel_id: "general",
    aggregate_type: "channel",
    aggregate_id: "general",
    event_type: "channel_projection_upsert",
    source_version: 4,
    payload_json: JSON.stringify({
      owner_uid: "owner-1",
      show_on_profile: 1,
      created_at: "2026-09-10T00:00:00.000Z",
      state: "active",
    }),
    attempt_count: 1,
    ...overrides,
  };
}

class BoundStatement {
  readonly database: FakeDatabase;
  readonly sql: string;
  readonly values: unknown[];

  constructor(
    database: FakeDatabase,
    sql: string,
    values: unknown[] = [],
  ) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new BoundStatement(this.database, this.sql, values);
  }

  async run() {
    this.database.operations.push({ kind: "run", sql: this.sql, values: this.values });
    return { meta: { changes: 1 } };
  }

  async first<T>() {
    this.database.operations.push({ kind: "first", sql: this.sql, values: this.values });
    return this.database.row as T | null;
  }
}

class FakeDatabase {
  operations: Array<{ kind: string; sql: string; values: unknown[] }> = [];
  row: Record<string, unknown> | null = null;
  candidates: Array<{ id: string; created_at: string }> = [];
  failBatch = false;

  prepare(sql: string) {
    return new BoundStatement(this, sql);
  }

  async batch<T>(statements: BoundStatement[]) {
    this.operations.push(...statements.map((statement) => ({
      kind: "batch",
      sql: statement.sql,
      values: statement.values,
    })));
    if (this.failBatch) throw new Error("control unavailable");
    if (statements.some((statement) => statement.sql.includes("SELECT id, created_at"))) {
      return [
        { results: this.candidates },
        { results: [] },
      ] as Array<{ results: T[] }>;
    }
    return statements.map(() => ({ results: [] })) as Array<{ results: T[] }>;
  }
}

class SqliteStatement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
  private readonly values: unknown[];

  constructor(database: DatabaseSync, sql: string, values: unknown[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new SqliteStatement(this.database, this.sql, values);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

class SqliteDatabase {
  readonly sqlite = new DatabaseSync(":memory:");

  prepare(sql: string) {
    return new SqliteStatement(this.sqlite, sql);
  }

  async batch<T>(statements: SqliteStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.sqlite.exec("COMMIT");
      return results as Array<{ results: T[] }>;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

test("projection payload parsing accepts only the bounded event contract", () => {
  assert.deepEqual(parseChannelProjectionEvent(eventRow()), {
    id: "event-1",
    channelId: "general",
    sourceVersion: 4,
    type: "upsert",
    ownerUid: "owner-1",
    showOnProfile: 1,
    createdAt: "2026-09-10T00:00:00.000Z",
  });
  assert.equal(parseChannelProjectionEvent(eventRow({
    aggregate_id: "another-channel",
  })), null);
  assert.equal(parseChannelProjectionEvent(eventRow({
    payload_json: JSON.stringify({
      owner_uid: "owner-1",
      show_on_profile: 2,
      created_at: null,
      state: "active",
    }),
  })), null);
  assert.equal(parseChannelProjectionEvent(eventRow({
    event_type: "channel_projection_delete",
    payload_json: JSON.stringify({ state: "deleted", passcode: "not-copied" }),
  })), null);
  assert.deepEqual(parseChannelProjectionEvent(eventRow({
    event_type: "channel_projection_delete",
    payload_json: JSON.stringify({ state: "deleted" }),
  })), {
    id: "event-1",
    channelId: "general",
    sourceVersion: 4,
    type: "delete",
  });
});

test("control writes update the watermark before an idempotent projection write", async () => {
  const control = new FakeDatabase();
  const event = parseChannelProjectionEvent(eventRow());
  assert.ok(event);

  await applyChannelProjectionEvent(
    control as unknown as D1Database,
    event,
    "2026-09-10T00:01:00.000Z",
  );

  assert.equal(control.operations.length, 2);
  assert.match(control.operations[0].sql, /INSERT INTO channel_projection_versions/);
  assert.match(control.operations[0].sql, /excluded\.source_version > channel_projection_versions\.source_version/);
  assert.match(control.operations[1].sql, /INSERT INTO channel_control_projections/);
  assert.match(control.operations[1].sql, /source_version = \?/);
  assert.doesNotMatch(control.operations[1].sql, /passcode|moderation|payload_json/);
});

test("source acknowledgement occurs only after the separate control batch commits", async () => {
  const source = new FakeDatabase();
  const control = new FakeDatabase();
  source.candidates = [{ id: "event-1", created_at: "2026-09-10T00:00:00.000Z" }];
  source.row = eventRow();

  const result = await drainChannelProjectionEvents({
    sourceDatabase: source as unknown as D1Database,
    controlDatabase: control as unknown as D1Database,
    nowMs: Date.parse("2026-09-10T00:01:00.000Z"),
  });

  assert.deepEqual(result, { claimed: 1, delivered: 1, retried: 0, dead: 0 });
  assert.ok(control.operations.some((operation) =>
    operation.kind === "batch"
    && operation.sql.includes("channel_projection_versions")
  ));
  const acknowledgement = source.operations.find((operation) =>
    operation.kind === "run"
    && operation.sql.includes("status = 'delivered'")
  );
  assert.ok(acknowledgement);
});

test("failed control writes retain a bounded retry without leaking the exception", async () => {
  const source = new FakeDatabase();
  const control = new FakeDatabase();
  source.candidates = [{ id: "event-1", created_at: "2026-09-10T00:00:00.000Z" }];
  source.row = eventRow();
  control.failBatch = true;

  const result = await drainChannelProjectionEvents({
    sourceDatabase: source as unknown as D1Database,
    controlDatabase: control as unknown as D1Database,
    nowMs: Date.parse("2026-09-10T00:01:00.000Z"),
  });

  assert.deepEqual(result, { claimed: 1, delivered: 0, retried: 1, dead: 0 });
  const retry = source.operations.find((operation) =>
    operation.kind === "run"
    && operation.sql.includes("projection_control_write_failed")
  );
  assert.ok(retry);
  assert.doesNotMatch(JSON.stringify(source.operations), /control unavailable/);
  assert.equal(
    source.operations.some((operation) => operation.sql.includes("status = 'delivered'")),
    false,
  );
});

test("out-of-order events cannot resurrect a deleted projection", async () => {
  const control = new SqliteDatabase();
  control.sqlite.exec(`
    CREATE TABLE channel_projection_versions (
      channel_id TEXT PRIMARY KEY,
      source_version INTEGER NOT NULL,
      state TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE channel_control_projections (
      channel_id TEXT PRIMARY KEY,
      owner_uid TEXT NOT NULL,
      show_on_profile INTEGER NOT NULL,
      created_at TEXT,
      projection_version INTEGER NOT NULL,
      projected_at TEXT NOT NULL,
      source_version INTEGER NOT NULL
    );
  `);
  const database = control as unknown as D1Database;
  const now = "2026-09-10T00:01:00.000Z";

  await applyChannelProjectionEvent(database, {
    id: "event-1",
    channelId: "general",
    sourceVersion: 1,
    type: "upsert",
    ownerUid: "owner-old",
    showOnProfile: 1,
    createdAt: "2026-09-09T00:00:00.000Z",
  }, now);
  await applyChannelProjectionEvent(database, {
    id: "event-3",
    channelId: "general",
    sourceVersion: 3,
    type: "delete",
  }, now);
  await applyChannelProjectionEvent(database, {
    id: "event-2",
    channelId: "general",
    sourceVersion: 2,
    type: "upsert",
    ownerUid: "stale-owner",
    showOnProfile: 1,
    createdAt: "2026-09-09T00:00:00.000Z",
  }, now);

  assert.equal(
    control.sqlite.prepare(
      "SELECT channel_id FROM channel_control_projections WHERE channel_id = ?",
    ).get("general"),
    undefined,
  );
  assert.deepEqual(
    { ...control.sqlite.prepare(
      "SELECT source_version, state FROM channel_projection_versions WHERE channel_id = ?",
    ).get("general") },
    { source_version: 3, state: "deleted" },
  );

  await applyChannelProjectionEvent(database, {
    id: "event-4",
    channelId: "general",
    sourceVersion: 4,
    type: "upsert",
    ownerUid: "owner-new",
    showOnProfile: 0,
    createdAt: "2026-09-10T00:00:00.000Z",
  }, now);
  assert.deepEqual(
    { ...control.sqlite.prepare(`
      SELECT owner_uid, show_on_profile, source_version
      FROM channel_control_projections
      WHERE channel_id = ?
    `).get("general") },
    {
      owner_uid: "owner-new",
      show_on_profile: 0,
      source_version: 4,
    },
  );
});
