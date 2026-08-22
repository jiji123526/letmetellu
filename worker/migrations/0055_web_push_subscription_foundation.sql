-- Authenticated-user Web Push preferences and browser subscriptions.
-- This migration intentionally does not add delivery/outbox behavior.

CREATE TABLE notification_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'off'
    CHECK (mode IN ('off', 'important', 'all')),
  quiet_hours_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX notification_preferences_delivery_idx
  ON notification_preferences(channel_id, mode, user_id)
  WHERE mode IN ('important', 'all');

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  user_agent_family TEXT,
  device_label TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_success_at TEXT,
  last_failure_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  revoked_at TEXT
);

CREATE INDEX push_subscriptions_active_user_idx
  ON push_subscriptions(user_id, updated_at DESC)
  WHERE revoked_at IS NULL;

