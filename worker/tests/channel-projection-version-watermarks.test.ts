import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync(
  new URL(
    "../migrations/0066_channel_projection_version_watermarks.sql",
    import.meta.url,
  ),
  "utf8",
);

test("projection versions survive channel deletion and recreation", () => {
  assert.match(migrationSource, /CREATE TABLE channel_projection_versions/);
  assert.match(migrationSource, /channel_id TEXT PRIMARY KEY/);
  assert.match(migrationSource, /state IN \('active', 'deleted'\)/);
  assert.match(
    migrationSource,
    /ON CONFLICT\(channel_id\) DO UPDATE SET\s+source_version = channel_projection_versions\.source_version \+ 1/,
  );
  assert.match(
    migrationSource,
    /channel_control_projection_delete[\s\S]*source_version = source_version \+ 1,[\s\S]*state = 'deleted'/,
  );
});

test("all projection events use the persisted version watermark", () => {
  const eventVersionReads = migrationSource.match(
    /SELECT source_version FROM channel_projection_versions WHERE channel_id = (?:NEW|OLD)\.id/g,
  ) || [];
  assert.equal(eventVersionReads.length, 5);
  assert.doesNotMatch(
    migrationSource,
    /'channel_projection_(?:upsert|delete)',\s*(?:NEW|OLD)\.projection_source_version/,
  );
});

test("live channel rows do not create independent projection versions", () => {
  const triggerGuards = migrationSource.match(/WHEN NEW\.id NOT LIKE '%_live'/g) || [];
  assert.equal(triggerGuards.length, 2);
  assert.match(
    migrationSource,
    /channel_control_projection_delete[\s\S]*WHEN OLD\.id NOT LIKE '%_live'/,
  );
});
