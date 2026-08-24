import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync(
  new URL("../migrations/0062_notification_retention.sql", import.meta.url),
  "utf8",
);
const maintenanceSource = readFileSync(
  new URL("../src/lib/maintenance.ts", import.meta.url),
  "utf8",
);
const auditSource = readFileSync(
  new URL("../scripts/audit-notification-operations.sql", import.meta.url),
  "utf8",
);

test("notification retention has bounded terminal and revoked lookup indexes", () => {
  assert.match(
    migrationSource,
    /notification_outbox_delivered_updated_idx[\s\S]*ON notification_outbox\(updated_at\)[\s\S]*WHERE status = 'delivered'/,
  );
  assert.match(
    migrationSource,
    /notification_outbox_dead_updated_idx[\s\S]*ON notification_outbox\(updated_at\)[\s\S]*WHERE status = 'dead'/,
  );
  assert.match(
    migrationSource,
    /notification_outbox_subscription_idx[\s\S]*ON notification_outbox\(subscription_id\)/,
  );
  assert.match(
    migrationSource,
    /push_subscriptions_revoked_at_idx[\s\S]*ON push_subscriptions\(revoked_at\)/,
  );
});

test("hourly maintenance retains terminal notification diagnostics for bounded periods", () => {
  assert.match(maintenanceSource, /NOTIFICATION_DELIVERED_RETENTION_MS = 30 \* DAY_MS/);
  assert.match(maintenanceSource, /NOTIFICATION_DEAD_RETENTION_MS = 90 \* DAY_MS/);
  assert.match(maintenanceSource, /REVOKED_PUSH_SUBSCRIPTION_RETENTION_MS = 90 \* DAY_MS/);
  assert.match(maintenanceSource, /status: "delivered" \| "dead"/);
  assert.match(maintenanceSource, /DELETE FROM notification_outbox[\s\S]*WHERE rowid IN \(\s*SELECT rowid/);
  assert.match(maintenanceSource, /notification_outbox_delivered_updated_idx/);
  assert.match(maintenanceSource, /notification_outbox_dead_updated_idx/);
  assert.match(maintenanceSource, /for \(let batch = 0; batch < CLEANUP_MAX_BATCHES; batch\+\+\)/);
  assert.doesNotMatch(
    maintenanceSource,
    /drainTerminalNotificationRetention\([\s\S]{0,120}"(?:pending|retry|processing)"/,
  );
});

test("revoked subscription cleanup preserves rows still referenced by the outbox", () => {
  assert.match(
    maintenanceSource,
    /DELETE FROM push_subscriptions[\s\S]*NOT EXISTS \([\s\S]*FROM notification_outbox AS outbox INDEXED BY notification_outbox_subscription_idx[\s\S]*outbox\.subscription_id = subscription\.id/,
  );
  assert.match(
    maintenanceSource,
    /drainTerminalNotificationRetention\([\s\S]*drainRevokedPushSubscriptionRetention\(/,
  );
});

test("notification operations audit reports backlog and expired retention rows", () => {
  assert.match(auditSource, /oldest_ready_created_at/);
  assert.match(auditSource, /expired_delivered_rows/);
  assert.match(auditSource, /expired_dead_rows/);
  assert.match(auditSource, /expired_unreferenced_revoked_subscriptions/);
  assert.match(auditSource, /notification_outbox_attempt_ready_idx/);
  assert.match(auditSource, /notification_outbox_lease_ready_idx/);
  assert.doesNotMatch(auditSource, /'notification_outbox_ready_idx'/);
});
