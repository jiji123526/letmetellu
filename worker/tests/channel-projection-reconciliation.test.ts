import assert from "node:assert/strict";
import test from "node:test";
import { reconcileChannelProjections } from "../src/lib/channel-projection-reconciliation.ts";

class ReconciliationStatement {
  private readonly database: ReconciliationDatabase;
  readonly sql: string;
  private readonly values: unknown[];

  constructor(
    database: ReconciliationDatabase,
    sql: string,
    values: unknown[] = [],
  ) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new ReconciliationStatement(this.database, this.sql, values);
  }

  async all<T>() {
    this.database.queries.push({ sql: this.sql, values: this.values });
    return { results: this.database.results as T[] };
  }
}

class ReconciliationDatabase {
  results: Array<Record<string, unknown>> = [];
  queries: Array<{ sql: string; values: unknown[] }> = [];

  prepare(sql: string) {
    return new ReconciliationStatement(this, sql);
  }
}

test("reconciliation reports bounded metadata without selecting event payloads", async () => {
  const source = new ReconciliationDatabase();
  const control = new ReconciliationDatabase();
  source.results = [
    {
      channel_id: "active-ok",
      source_version: 4,
      state: "active",
      owner_uid: "owner-1",
      show_on_profile: 1,
      created_at: "2026-09-01T00:00:00.000Z",
    },
    {
      channel_id: "deleted-stale",
      source_version: 3,
      state: "deleted",
      owner_uid: null,
      show_on_profile: null,
      created_at: null,
    },
    {
      channel_id: "missing-control",
      source_version: 2,
      state: "active",
      owner_uid: "owner-2",
      show_on_profile: 0,
      created_at: null,
    },
  ];
  control.results = [
    {
      channel_id: "active-ok",
      source_version: 4,
      state: "active",
      projected_source_version: 4,
      owner_uid: "owner-1",
      show_on_profile: 1,
      created_at: "2026-09-01T00:00:00.000Z",
    },
    {
      channel_id: "deleted-stale",
      source_version: 3,
      state: "deleted",
      projected_source_version: 2,
      owner_uid: "owner-old",
      show_on_profile: 1,
      created_at: null,
    },
  ];

  const result = await reconcileChannelProjections({
    sourceDatabase: source as unknown as D1Database,
    controlDatabase: control as unknown as D1Database,
    limit: 3,
  });

  assert.deepEqual(result, {
    checked: 3,
    issues: [
      {
        channelId: "deleted-stale",
        reason: "deleted_projection_present",
        sourceVersion: 3,
        controlVersion: 3,
      },
      {
        channelId: "missing-control",
        reason: "missing_control_watermark",
        sourceVersion: 2,
        controlVersion: null,
      },
    ],
    nextCursor: "missing-control",
  });
  assert.equal(source.queries.length, 1);
  assert.equal(control.queries.length, 1);
  assert.match(source.queries[0].sql, /ORDER BY version\.channel_id ASC\s+LIMIT \?/);
  assert.match(control.queries[0].sql, /WHERE version\.channel_id IN \(\?, \?, \?\)/);
  const allSql = [...source.queries, ...control.queries]
    .map((query) => query.sql)
    .join("\n");
  assert.doesNotMatch(allSql, /domain_events|payload_json|passcode|moderation|message/);
});

test("reconciliation distinguishes watermark and active projection mismatches", async () => {
  const source = new ReconciliationDatabase();
  const control = new ReconciliationDatabase();
  source.results = [
    {
      channel_id: "projection-stale",
      source_version: 5,
      state: "active",
      owner_uid: "owner-new",
      show_on_profile: 0,
      created_at: null,
    },
    {
      channel_id: "watermark-stale",
      source_version: 8,
      state: "active",
      owner_uid: "owner-2",
      show_on_profile: 1,
      created_at: null,
    },
  ];
  control.results = [
    {
      channel_id: "projection-stale",
      source_version: 5,
      state: "active",
      projected_source_version: 4,
      owner_uid: "owner-old",
      show_on_profile: 1,
      created_at: null,
    },
    {
      channel_id: "watermark-stale",
      source_version: 7,
      state: "active",
      projected_source_version: 7,
      owner_uid: "owner-2",
      show_on_profile: 1,
      created_at: null,
    },
  ];

  const result = await reconcileChannelProjections({
    sourceDatabase: source as unknown as D1Database,
    controlDatabase: control as unknown as D1Database,
  });
  assert.deepEqual(
    result.issues.map((issue) => issue.reason),
    ["active_projection_mismatch", "watermark_mismatch"],
  );
  assert.equal(result.nextCursor, null);
});
