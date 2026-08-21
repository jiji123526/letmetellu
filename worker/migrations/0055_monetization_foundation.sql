CREATE TABLE IF NOT EXISTS billing_orders (
  order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  billing_cycle TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  auto_renews INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_orders_provider_order_idx
  ON billing_orders(provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_orders_user_status_idx
  ON billing_orders(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  provider_payment_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES billing_orders(order_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  method TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  approved_at TEXT,
  canceled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS payments_order_status_idx
  ON payments(order_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_user_status_idx
  ON payments(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS user_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  source_order_id TEXT REFERENCES billing_orders(order_id) ON DELETE SET NULL,
  source_type TEXT NOT NULL DEFAULT 'billing',
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  auto_renews INTEGER NOT NULL DEFAULT 0,
  grandfathered_channel_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS user_entitlements_user_plan_status_idx
  ON user_entitlements(user_id, plan, status, ends_at, starts_at DESC);

CREATE INDEX IF NOT EXISTS user_entitlements_subscription_idx
  ON user_entitlements(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  provider_event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  processed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  failure_code TEXT,
  order_id TEXT REFERENCES billing_orders(order_id) ON DELETE SET NULL,
  user_id TEXT
);

CREATE INDEX IF NOT EXISTS billing_webhook_events_status_received_idx
  ON billing_webhook_events(status, received_at DESC);

CREATE TABLE IF NOT EXISTS image_quota_events (
  consumption_key TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  secondary_actor_key TEXT,
  secondary_actor_type TEXT,
  quota_date TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS image_quota_events_record_idx
  ON image_quota_events(record_type, record_id);

CREATE INDEX IF NOT EXISTS image_quota_events_actor_date_idx
  ON image_quota_events(actor_key, quota_date, created_at DESC);

CREATE INDEX IF NOT EXISTS image_quota_events_secondary_actor_date_idx
  ON image_quota_events(secondary_actor_key, quota_date, created_at DESC)
  WHERE secondary_actor_key IS NOT NULL;
