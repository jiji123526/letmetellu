import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../migrations/0055_web_push_subscription_foundation.sql", import.meta.url),
  "utf8",
);

test("notification foundation is authenticated-user-only and channel-scoped", () => {
  assert.match(
    migration,
    /user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/,
  );
  assert.match(
    migration,
    /channel_id TEXT NOT NULL REFERENCES channels\(id\) ON DELETE CASCADE/,
  );
  assert.match(migration, /PRIMARY KEY \(user_id, channel_id\)/);
  assert.doesNotMatch(migration, /anonymous|device_uid|read_state|unread/i);
});

test("notification modes and delivery lookup stay bounded", () => {
  assert.match(migration, /CHECK \(mode IN \('off', 'important', 'all'\)\)/);
  assert.match(
    migration,
    /notification_preferences_delivery_idx[\s\S]*\(channel_id, mode, user_id\)[\s\S]*WHERE mode IN \('important', 'all'\)/,
  );
});

test("push subscription secrets are user-owned and active lookups are indexed", () => {
  assert.match(migration, /endpoint TEXT NOT NULL UNIQUE/);
  assert.match(migration, /p256dh TEXT NOT NULL/);
  assert.match(migration, /auth TEXT NOT NULL/);
  assert.match(migration, /failure_count INTEGER NOT NULL DEFAULT 0 CHECK \(failure_count >= 0\)/);
  assert.match(
    migration,
    /push_subscriptions_active_user_idx[\s\S]*\(user_id, updated_at DESC\)[\s\S]*WHERE revoked_at IS NULL/,
  );
});

test("delivery outbox is deliberately deferred from the foundation migration", () => {
  assert.doesNotMatch(migration, /CREATE TABLE notification_outbox/);
});

