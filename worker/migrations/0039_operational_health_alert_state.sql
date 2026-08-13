CREATE TABLE operational_health_alert_state (
  alert_key TEXT PRIMARY KEY CHECK (alert_key = 'core_health'),
  notified_status TEXT NOT NULL CHECK (notified_status IN ('healthy', 'degraded', 'critical')),
  last_alert_kind TEXT CHECK (last_alert_kind IN ('degraded', 'critical', 'recovery')),
  last_alert_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO operational_health_alert_state (
  alert_key,
  notified_status,
  last_alert_kind,
  last_alert_at,
  updated_at
) VALUES (
  'core_health',
  'healthy',
  NULL,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
