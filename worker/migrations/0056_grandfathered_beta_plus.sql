CREATE UNIQUE INDEX IF NOT EXISTS user_entitlements_grandfathered_beta_user_idx
  ON user_entitlements(user_id, source_type)
  WHERE source_type = 'grandfathered_beta';

INSERT OR IGNORE INTO user_entitlements (
  id,
  user_id,
  provider,
  plan,
  status,
  starts_at,
  ends_at,
  source_order_id,
  source_type,
  provider_customer_id,
  provider_subscription_id,
  auto_renews,
  grandfathered_channel_id
)
SELECT
  'grandfathered-beta:' || users.id,
  users.id,
  NULL,
  'plus',
  'active',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL,
  NULL,
  'grandfathered_beta',
  NULL,
  NULL,
  0,
  NULL
FROM users
WHERE NOT EXISTS (
  SELECT 1
  FROM user_entitlements
  WHERE user_entitlements.user_id = users.id
    AND user_entitlements.plan = 'plus'
    AND user_entitlements.status = 'active'
    AND user_entitlements.starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    AND (
      user_entitlements.ends_at IS NULL
      OR user_entitlements.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
);
