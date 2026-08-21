CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  plan TEXT NOT NULL,
  billing_cycle TEXT NOT NULL,
  provider_customer_key TEXT NOT NULL,
  billing_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_order_id TEXT REFERENCES billing_orders(order_id) ON DELETE SET NULL,
  current_period_started_at TEXT NOT NULL,
  current_period_ends_at TEXT NOT NULL,
  next_charge_at TEXT NOT NULL,
  last_charged_at TEXT,
  last_failed_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  cancel_requested_at TEXT,
  canceled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_user_plan_provider_idx
  ON billing_subscriptions(user_id, provider, plan);

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_provider_billing_key_idx
  ON billing_subscriptions(provider, billing_key);

CREATE INDEX IF NOT EXISTS billing_subscriptions_status_next_charge_idx
  ON billing_subscriptions(status, next_charge_at, updated_at);
