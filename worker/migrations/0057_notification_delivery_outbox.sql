-- Durable, retryable Web Push delivery queue. Initial producer is self-test only.
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('self_test', 'admin_message', 'live_start')),
  event_key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  channel_id TEXT,
  subscription_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
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

CREATE INDEX notification_outbox_ready_idx
  ON notification_outbox(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry', 'processing');

