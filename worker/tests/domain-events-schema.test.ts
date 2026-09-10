import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync(
  new URL("../migrations/0065_channel_projection_domain_events.sql", import.meta.url),
  "utf8",
);
const auditSource = readFileSync(
  new URL("../scripts/audit-domain-events.sql", import.meta.url),
  "utf8",
);

test("domain events are durable, leased, bounded, and idempotent", () => {
  assert.match(migrationSource, /CREATE TABLE domain_events/);
  assert.match(
    migrationSource,
    /UNIQUE\(channel_id, event_type, aggregate_id, source_version\)/,
  );
  assert.match(
    migrationSource,
    /CHECK \(json_valid\(payload_json\) AND length\(payload_json\) <= 16384\)/,
  );
  assert.match(
    migrationSource,
    /status IN \('pending', 'processing', 'delivered', 'dead'\)/,
  );
  assert.match(migrationSource, /lease_until TEXT/);
  assert.match(migrationSource, /domain_events_attempt_ready_idx/);
  assert.match(migrationSource, /domain_events_lease_ready_idx/);
});

test("projection source events share the channel mutation transaction", () => {
  assert.match(migrationSource, /AFTER INSERT ON channels/);
  assert.match(
    migrationSource,
    /AFTER UPDATE OF owner_uid, show_on_profile, created_at ON channels/,
  );
  assert.match(migrationSource, /AFTER DELETE ON channels/);
  assert.match(migrationSource, /OLD\.projection_source_version \+ 1/);
  assert.match(migrationSource, /'channel_projection_upsert'/);
  assert.match(migrationSource, /'channel_projection_delete'/);
});

test("projection event payloads exclude channel secrets and message content", () => {
  const payloadFragments = [...migrationSource.matchAll(/json_object\(([^;]+?)\)/gs)]
    .map((match) => match[1])
    .join("\n");
  assert.match(payloadFragments, /'owner_uid'/);
  assert.match(payloadFragments, /'show_on_profile'/);
  assert.doesNotMatch(payloadFragments, /passcode/);
  assert.doesNotMatch(payloadFragments, /moderation/);
  assert.doesNotMatch(payloadFragments, /message|text|image/);
});

test("domain event audit is bounded and does not select payload content", () => {
  assert.match(auditSource, /GROUP BY status/);
  assert.match(auditSource, /invalid_payload_rows/);
  assert.match(auditSource, /LIMIT 100/);
  assert.doesNotMatch(auditSource, /SELECT\s+payload_json/);
});
