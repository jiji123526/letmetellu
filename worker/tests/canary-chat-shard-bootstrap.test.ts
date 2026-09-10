import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const bootstrapSource = readFileSync(
  new URL("../scripts/bootstrap-canary-chat-shard.sql", import.meta.url),
  "utf8",
);
const auditSource = readFileSync(
  new URL("../scripts/audit-canary-chat-shard.sql", import.meta.url),
  "utf8",
);

function createPreparedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      owner_uid TEXT NOT NULL,
      show_on_profile INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      projection_source_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE channel_control_projections (
      channel_id TEXT PRIMARY KEY,
      owner_uid TEXT NOT NULL,
      show_on_profile INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      projection_version INTEGER NOT NULL DEFAULT 1,
      projected_at TEXT NOT NULL,
      source_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE channel_projection_versions (
      channel_id TEXT PRIMARY KEY,
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
    CREATE INDEX domain_events_delivered_updated_idx
      ON domain_events(updated_at) WHERE status = 'delivered';
    CREATE INDEX domain_events_dead_updated_idx
      ON domain_events(updated_at) WHERE status = 'dead';
    CREATE TRIGGER channel_control_projection_insert
      AFTER INSERT ON channels BEGIN SELECT 1; END;
    CREATE TRIGGER channel_control_projection_update
      AFTER UPDATE OF owner_uid, show_on_profile, created_at ON channels
      BEGIN SELECT 1; END;
    CREATE TRIGGER channel_control_projection_delete
      AFTER DELETE ON channels BEGIN SELECT 1; END;
  `);
  return database;
}

test("canary bootstrap requires an empty fully migrated database", () => {
  const database = createPreparedDatabase();
  database.prepare(`
    INSERT INTO channels (
      id, owner_uid, show_on_profile, created_at, projection_source_version
    ) VALUES (?, ?, ?, ?, ?)
  `).run("existing", "owner-1", 1, "2026-09-10T00:00:00.000Z", 1);

  assert.throws(
    () => database.exec(bootstrapSource),
    /CHECK constraint failed/,
  );
  const trigger = database.prepare(`
    SELECT sql
    FROM sqlite_schema
    WHERE type = 'trigger' AND name = 'channel_control_projection_insert'
  `).get() as { sql: string };
  assert.doesNotMatch(trigger.sql, /domain_events/);

  const incompleteDatabase = createPreparedDatabase();
  incompleteDatabase.exec("DROP INDEX domain_events_dead_updated_idx");
  assert.throws(
    () => incompleteDatabase.exec(bootstrapSource),
    /CHECK constraint failed/,
  );
});

test("canary triggers emit events without writing a local control projection", () => {
  const database = createPreparedDatabase();
  database.exec(bootstrapSource);

  const metadata = database.prepare(`
    SELECT shard_role, bootstrap_version
    FROM chat_shard_metadata
    WHERE id = 1
  `).get();
  assert.deepEqual({ ...metadata }, {
    shard_role: "chat-canary",
    bootstrap_version: 1,
  });

  database.prepare(`
    INSERT INTO channels (
      id, owner_uid, show_on_profile, created_at, projection_source_version
    ) VALUES (?, ?, ?, ?, ?)
  `).run("canary-room", "owner-1", 1, "2026-09-10T00:00:00.000Z", 1);
  database.prepare(`
    UPDATE channels SET owner_uid = ? WHERE id = ?
  `).run("owner-2", "canary-room");
  database.prepare("DELETE FROM channels WHERE id = ?").run("canary-room");

  assert.equal(
    database.prepare("SELECT COUNT(*) AS rows FROM channel_control_projections").get()?.rows,
    0,
  );
  const watermark = database.prepare(`
      SELECT source_version, state
      FROM channel_projection_versions
      WHERE channel_id = ?
    `).get("canary-room");
  assert.deepEqual(
    { ...watermark },
    { source_version: 3, state: "deleted" },
  );
  const events = database.prepare(`
    SELECT event_type, source_version
    FROM domain_events
    WHERE channel_id = ?
    ORDER BY source_version
  `).all("canary-room").map((row) => ({ ...row }));
  assert.deepEqual(
    events,
    [
      { event_type: "channel_projection_upsert", source_version: 1 },
      { event_type: "channel_projection_upsert", source_version: 2 },
      { event_type: "channel_projection_delete", source_version: 3 },
    ],
  );

  database.prepare(`
    INSERT INTO channels (
      id, owner_uid, show_on_profile, created_at, projection_source_version
    ) VALUES (?, ?, ?, ?, ?)
  `).run("canary-room", "owner-3", 0, "2026-09-10T01:00:00.000Z", 1);
  database.prepare(`
    INSERT INTO channels (
      id, owner_uid, show_on_profile, created_at, projection_source_version
    ) VALUES (?, ?, ?, ?, ?)
  `).run("canary-room_live", "owner-3", 0, "2026-09-10T01:00:00.000Z", 1);

  const recreatedWatermark = database.prepare(`
    SELECT source_version, state
    FROM channel_projection_versions
    WHERE channel_id = ?
  `).get("canary-room");
  assert.deepEqual(
    { ...recreatedWatermark },
    { source_version: 4, state: "active" },
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS rows
      FROM domain_events
      WHERE channel_id = ?
    `).get("canary-room")?.rows,
    4,
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS rows
      FROM domain_events
      WHERE channel_id = ?
    `).get("canary-room_live")?.rows,
    0,
  );
});

test("canary bootstrap and audit avoid channel secrets and event payload output", () => {
  const triggerDefinitions = [...bootstrapSource.matchAll(
    /CREATE TRIGGER[\s\S]+?END;/g,
  )].map((match) => match[0]).join("\n");
  assert.doesNotMatch(triggerDefinitions, /channel_control_projections/);
  assert.match(triggerDefinitions, /domain_events/);
  assert.match(triggerDefinitions, /channel_projection_versions/);

  assert.match(auditSource, /PRAGMA quick_check/);
  assert.match(auditSource, /PRAGMA foreign_key_check/);
  assert.match(auditSource, /writes_local_projection/);
  assert.match(auditSource, /LIMIT 100/);
  assert.doesNotMatch(auditSource, /SELECT\s+payload_json/);
  const selectStatements = auditSource
    .replace(/^--.*$/gm, "")
    .split(";")
    .filter((statement) => /\bSELECT\b/i.test(statement))
    .join("\n");
  assert.doesNotMatch(
    selectStatements,
    /SELECT[\s\S]*\b(?:passcode|moderation|message_text|media_key)\b/i,
  );
});
