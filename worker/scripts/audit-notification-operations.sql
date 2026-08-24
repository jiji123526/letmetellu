SELECT
  status,
  COUNT(*) AS rows,
  MIN(created_at) AS oldest_created_at,
  MAX(updated_at) AS newest_updated_at
FROM notification_outbox
GROUP BY status
ORDER BY status;

SELECT
  event_type,
  status,
  COUNT(*) AS rows
FROM notification_outbox
WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')
GROUP BY event_type, status
ORDER BY event_type, status;

SELECT
  COUNT(*) AS ready_rows,
  MIN(created_at) AS oldest_ready_created_at,
  MIN(next_attempt_at) AS oldest_ready_attempt_at
FROM notification_outbox
WHERE (
    status IN ('pending', 'retry')
    AND next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  OR (
    status = 'processing'
    AND lease_until < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );

SELECT
  COALESCE(SUM(CASE
    WHEN status = 'delivered'
      AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
    THEN 1 ELSE 0 END
  ), 0) AS expired_delivered_rows,
  COALESCE(SUM(CASE
    WHEN status = 'dead'
      AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')
    THEN 1 ELSE 0 END
  ), 0) AS expired_dead_rows
FROM notification_outbox;

SELECT
  COALESCE(SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END), 0) AS active_subscriptions,
  COALESCE(SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS revoked_subscriptions,
  COALESCE(SUM(CASE
    WHEN revoked_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')
      AND NOT EXISTS (
        SELECT 1
        FROM notification_outbox
        WHERE notification_outbox.subscription_id = push_subscriptions.id
      )
    THEN 1 ELSE 0 END
  ), 0) AS expired_unreferenced_revoked_subscriptions
FROM push_subscriptions;

SELECT
  name,
  type
FROM sqlite_schema
WHERE name IN (
  'notification_outbox_attempt_ready_idx',
  'notification_outbox_lease_ready_idx',
  'notification_outbox_delivered_updated_idx',
  'notification_outbox_dead_updated_idx',
  'notification_outbox_subscription_idx',
  'push_subscriptions_active_user_idx',
  'push_subscriptions_revoked_at_idx'
)
ORDER BY name;
