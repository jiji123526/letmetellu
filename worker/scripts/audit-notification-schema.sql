SELECT name, type
FROM sqlite_schema
WHERE name IN (
  'notification_preferences',
  'notification_preferences_delivery_idx',
  'push_subscriptions',
  'push_subscriptions_active_user_idx'
)
ORDER BY type DESC, name;

PRAGMA foreign_key_list(notification_preferences);
PRAGMA table_info(notification_preferences);
PRAGMA foreign_key_list(push_subscriptions);

EXPLAIN QUERY PLAN
SELECT user_id
FROM notification_preferences
WHERE channel_id = 'audit-channel'
  AND mode IN ('important', 'all');

EXPLAIN QUERY PLAN
SELECT id, endpoint, p256dh, auth
FROM push_subscriptions
WHERE user_id = 'audit-user'
  AND revoked_at IS NULL
ORDER BY updated_at DESC;
