SELECT
  event_type,
  COUNT(*) AS events,
  MAX(created_at) AS latest
FROM operational_events
WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
  AND event_type IN (
    'email_verification_sent',
    'email_verification_completed',
    'email_verification_delivery_failed',
    'password_reset_sent',
    'password_reset_completed',
    'password_reset_delivery_failed',
    'legacy_password_upgrade_succeeded',
    'legacy_password_upgrade_failed'
  )
GROUP BY event_type
ORDER BY event_type;

SELECT
  COUNT(*) AS remaining_legacy_passwords
FROM users
WHERE password_hash IS NOT NULL
  AND password_hash NOT LIKE 'pbkdf2-sha256$%';

SELECT
  event_type,
  status_code,
  created_at
FROM operational_events
WHERE event_type IN (
    'email_verification_delivery_failed',
    'password_reset_delivery_failed',
    'legacy_password_upgrade_failed'
  )
ORDER BY created_at DESC
LIMIT 20;
