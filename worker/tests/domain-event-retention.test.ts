import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drainDomainEventRetention } from "../src/lib/domain-event-retention.ts";

const migrationSource = readFileSync(
  new URL("../migrations/0067_domain_event_retention.sql", import.meta.url),
  "utf8",
);

class RetentionStatement {
  private readonly database: RetentionDatabase;
  private readonly sql: string;
  private readonly values: unknown[];

  constructor(database: RetentionDatabase, sql: string, values: unknown[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new RetentionStatement(this.database, this.sql, values);
  }

  async run() {
    this.database.operations.push({ sql: this.sql, values: this.values });
    return { meta: { changes: 0 } };
  }
}

class RetentionDatabase {
  operations: Array<{ sql: string; values: unknown[] }> = [];

  prepare(sql: string) {
    return new RetentionStatement(this, sql);
  }
}

class SqliteRetentionStatement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
  private readonly values: unknown[];

  constructor(database: DatabaseSync, sql: string, values: unknown[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new SqliteRetentionStatement(this.database, this.sql, values);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class SqliteRetentionDatabase {
  readonly sqlite = new DatabaseSync(":memory:");

  prepare(sql: string) {
    return new SqliteRetentionStatement(this.sqlite, sql);
  }
}

test("terminal event retention uses status-specific partial indexes", () => {
  assert.match(
    migrationSource,
    /domain_events_delivered_updated_idx[\s\S]*ON domain_events\(updated_at\)[\s\S]*WHERE status = 'delivered'/,
  );
  assert.match(
    migrationSource,
    /domain_events_dead_updated_idx[\s\S]*ON domain_events\(updated_at\)[\s\S]*WHERE status = 'dead'/,
  );
});

test("retention deletes only expired delivered and dead events", async () => {
  const database = new RetentionDatabase();
  const nowMs = Date.parse("2026-09-10T00:00:00.000Z");

  const result = await drainDomainEventRetention(
    database as unknown as D1Database,
    nowMs,
  );

  assert.deepEqual(result, { deliveredDeleted: 0, deadDeleted: 0 });
  assert.equal(database.operations.length, 2);
  assert.match(database.operations[0].sql, /INDEXED BY domain_events_delivered_updated_idx/);
  assert.match(database.operations[0].sql, /status = 'delivered'/);
  assert.equal(
    database.operations[0].values[0],
    "2026-08-11T00:00:00.000Z",
  );
  assert.match(database.operations[1].sql, /INDEXED BY domain_events_dead_updated_idx/);
  assert.match(database.operations[1].sql, /status = 'dead'/);
  assert.equal(
    database.operations[1].values[0],
    "2026-06-12T00:00:00.000Z",
  );
  assert.doesNotMatch(
    database.operations.map((operation) => operation.sql).join("\n"),
    /status = '(?:pending|processing)'/,
  );
});

test("retention preserves unresolved and recent terminal rows in SQLite", async () => {
  const database = new SqliteRetentionDatabase();
  database.sqlite.exec(`
    CREATE TABLE domain_events (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    ${migrationSource}
    INSERT INTO domain_events VALUES
      ('delivered-old', 'delivered', '2026-08-01T00:00:00.000Z'),
      ('delivered-recent', 'delivered', '2026-09-01T00:00:00.000Z'),
      ('dead-old', 'dead', '2026-06-01T00:00:00.000Z'),
      ('dead-recent', 'dead', '2026-08-01T00:00:00.000Z'),
      ('pending-old', 'pending', '2026-01-01T00:00:00.000Z'),
      ('processing-old', 'processing', '2026-01-01T00:00:00.000Z');
  `);

  const result = await drainDomainEventRetention(
    database as unknown as D1Database,
    Date.parse("2026-09-10T00:00:00.000Z"),
  );
  assert.deepEqual(result, { deliveredDeleted: 1, deadDeleted: 1 });
  const remaining = database.sqlite.prepare(
    "SELECT id FROM domain_events ORDER BY id",
  ).all().map((row) => row.id);
  assert.deepEqual(remaining, [
    "dead-recent",
    "delivered-recent",
    "pending-old",
    "processing-old",
  ]);
});
