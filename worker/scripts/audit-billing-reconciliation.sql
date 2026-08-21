SELECT
  status,
  COUNT(*) AS events,
  MIN(received_at) AS oldest_received_at,
  MAX(received_at) AS newest_received_at
FROM billing_webhook_events
GROUP BY status
ORDER BY status;

SELECT
  COUNT(*) AS stuck_webhook_events
FROM billing_webhook_events
WHERE status = 'processing'
  AND (
    processing_started_at IS NULL
    OR processing_started_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')
  );

SELECT
  COUNT(*) AS terminal_payment_active_entitlements
FROM payments
INNER JOIN user_entitlements
  ON user_entitlements.source_order_id = payments.order_id
 AND user_entitlements.source_type = 'billing'
WHERE payments.status IN ('canceled', 'refunded')
  AND user_entitlements.status = 'active'
  AND (
    user_entitlements.ends_at IS NULL
    OR user_entitlements.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );

SELECT
  COUNT(*) AS terminal_order_paid_payments
FROM billing_orders
INNER JOIN payments ON payments.order_id = billing_orders.order_id
WHERE billing_orders.status IN ('canceled', 'refunded')
  AND payments.status = 'paid';

SELECT
  COUNT(*) AS nonrenewing_subscription_autorenew_entitlements
FROM billing_subscriptions
INNER JOIN user_entitlements
  ON user_entitlements.source_order_id = billing_subscriptions.current_period_order_id
 AND user_entitlements.source_type = 'billing'
WHERE billing_subscriptions.status IN ('non_renewing', 'canceled')
  AND user_entitlements.auto_renews = 1;

SELECT
  provider_event_id,
  provider,
  event_type,
  status,
  failure_code,
  attempt_count,
  received_at,
  processing_started_at,
  processed_at
FROM billing_webhook_events
WHERE status IN ('failed', 'processing')
ORDER BY received_at DESC
LIMIT 50;
