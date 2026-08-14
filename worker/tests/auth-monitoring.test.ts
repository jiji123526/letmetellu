import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { serializeAuthMonitoringSummary } from "../src/lib/auth-monitoring.ts";

const authSource = readFileSync(
  new URL("../src/routes/auth.ts", import.meta.url),
  "utf8",
);
const supportSource = readFileSync(
  new URL("../src/routes/support.ts", import.meta.url),
  "utf8",
);
const cardSource = readFileSync(
  new URL("../../src/components/support/PlatformOperationalHealthCard.tsx", import.meta.url),
  "utf8",
);

test("authentication monitoring normalizes aggregate D1 values", () => {
  assert.deepEqual(serializeAuthMonitoringSummary({
    email_verification_sent_count: "3",
    email_verification_completed_count: 2,
    email_verification_delivery_failed_count: null,
    password_reset_sent_count: "4",
    password_reset_completed_count: 1,
    password_reset_delivery_failed_count: "1",
    legacy_password_upgrade_succeeded_count: "2",
    legacy_password_upgrade_failed_count: -1,
    remaining_legacy_password_count: "5",
    last_failure_at: "2026-08-14T12:00:00.000Z",
  }), {
    window_hours: 24,
    email_verification: { sent: 3, completed: 2, delivery_failed: 0 },
    password_reset: { sent: 4, completed: 1, delivery_failed: 1 },
    legacy_password_upgrade: { succeeded: 2, failed: 0, remaining: 5 },
    last_failure_at: "2026-08-14T12:00:00.000Z",
  });
});

test("auth routes record delivery, completion and legacy-upgrade outcomes", () => {
  [
    "email_verification_sent",
    "email_verification_completed",
    "email_verification_delivery_failed",
    "password_reset_sent",
    "password_reset_completed",
    "password_reset_delivery_failed",
    "legacy_password_upgrade_succeeded",
    "legacy_password_upgrade_failed",
  ].forEach((eventType) => {
    assert.match(authSource, new RegExp(`eventType: "${eventType}"`));
  });
  assert.match(authSource, /WHERE id = \? AND password_hash = \?/);
  assert.match(authSource, /if \(result\.meta\.changes\)/);
  assert.match(authSource, /if \(results\[1\]\.meta\.changes\)/);
});

test("platform health exposes bounded auth aggregates without changing core thresholds", () => {
  assert.match(supportSource, /AS remaining_legacy_password_count/);
  assert.match(supportSource, /auth_monitoring: serializeAuthMonitoringSummary\(authMonitoringRow\)/);
  assert.match(cardSource, /health\?\.auth_monitoring/);
  assert.match(cardSource, /operationalAuthLegacyUpgrade/);
});
