import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync(
  new URL("../migrations/0064_channel_control_projections.sql", import.meta.url),
  "utf8",
);
const initSource = readFileSync(
  new URL("../src/routes/init.ts", import.meta.url),
  "utf8",
);
const auditSource = readFileSync(
  new URL("../scripts/audit-channel-control-projections.sql", import.meta.url),
  "utf8",
);
const repairSource = readFileSync(
  new URL("../scripts/repair-channel-control-projections.sql", import.meta.url),
  "utf8",
);
const tableDefinition = migrationSource.slice(
  migrationSource.indexOf("CREATE TABLE channel_control_projections"),
  migrationSource.indexOf(");", migrationSource.indexOf("CREATE TABLE channel_control_projections")) + 2,
);

test("control projection excludes authorization state and live channels", () => {
  assert.match(migrationSource, /CREATE TABLE channel_control_projections/);
  assert.match(migrationSource, /channel_id TEXT PRIMARY KEY/);
  assert.match(migrationSource, /owner_uid TEXT NOT NULL/);
  assert.match(migrationSource, /show_on_profile INTEGER NOT NULL/);
  assert.doesNotMatch(tableDefinition, /\bpasscode\b/);
  assert.doesNotMatch(tableDefinition, /\bmoderation\b/);
  assert.match(migrationSource, /WHERE id NOT LIKE '%_live'/);
});

test("single-database channel writes maintain the projection atomically", () => {
  assert.match(migrationSource, /AFTER INSERT ON channels/);
  assert.match(
    migrationSource,
    /AFTER UPDATE OF owner_uid, show_on_profile, created_at ON channels/,
  );
  assert.match(migrationSource, /AFTER DELETE ON channels/);
  assert.match(
    migrationSource,
    /projection_version = channel_control_projections\.projection_version \+ 1/,
  );
});

test("split init enrichment reads the explicit control projection", () => {
  assert.match(
    initSource,
    /FROM channel_control_projections\s+WHERE channel_id = \?/,
  );
  assert.match(
    initSource,
    /FROM channel_control_projections AS owner_channels/,
  );
});

test("projection operations include bounded audit and idempotent repair SQL", () => {
  assert.match(auditSource, /missing_rows/);
  assert.match(auditSource, /mismatched_rows/);
  assert.match(auditSource, /orphaned_rows/);
  assert.match(auditSource, /LIMIT 100/);
  assert.match(repairSource, /ON CONFLICT\(channel_id\) DO UPDATE SET/);
  assert.match(repairSource, /WHERE channel_control_projections\.owner_uid != excluded\.owner_uid/);
  assert.match(repairSource, /DELETE FROM channel_control_projections/);
});
