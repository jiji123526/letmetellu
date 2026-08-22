-- Expand the delivery outbox for role-aware channel notifications and
-- coalesced message bursts. Rebuilding is required because SQLite cannot
-- alter the existing event_type CHECK constraint in place.

ALTER TABLE notification_outbox RENAME TO notification_outbox_legacy;

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'self_test', 'channel_message', 'live_start', 'dm',
    'message_report', 'channel_report'
  )),
  event_key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  channel_id TEXT,
  subscription_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  aggregate_count INTEGER NOT NULL DEFAULT 1 CHECK (aggregate_count >= 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry', 'delivered', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO notification_outbox (
  id, event_type, event_key, user_id, channel_id, subscription_id,
  payload_json, aggregate_count, status, attempt_count, next_attempt_at,
  lease_until, last_error_code, created_at, updated_at
)
SELECT
  id, CASE WHEN event_type = 'admin_message' THEN 'channel_message' ELSE event_type END,
  event_key, user_id, channel_id, subscription_id,
  payload_json, 1, status, attempt_count, next_attempt_at,
  lease_until, last_error_code, created_at, updated_at
FROM notification_outbox_legacy;

DROP TABLE notification_outbox_legacy;

CREATE INDEX notification_outbox_ready_idx
  ON notification_outbox(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry', 'processing');
