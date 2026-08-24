-- Bounds terminal retention scans without adding completed rows to the
-- ready-delivery index. Separate predicates let SQLite prove each partial
-- index matches its cleanup query.
CREATE INDEX IF NOT EXISTS notification_outbox_delivered_updated_idx
  ON notification_outbox(updated_at)
  WHERE status = 'delivered';

CREATE INDEX IF NOT EXISTS notification_outbox_dead_updated_idx
  ON notification_outbox(updated_at)
  WHERE status = 'dead';

-- Supports safe revoked-subscription cleanup after retained outbox rows expire.
CREATE INDEX IF NOT EXISTS notification_outbox_subscription_idx
  ON notification_outbox(subscription_id);

CREATE INDEX IF NOT EXISTS push_subscriptions_revoked_at_idx
  ON push_subscriptions(revoked_at);
