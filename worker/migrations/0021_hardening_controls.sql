CREATE TABLE durable_rate_limits (
  scope TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  window_start_ms INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, subject_key, window_start_ms)
);

CREATE INDEX durable_rate_limits_updated_idx
  ON durable_rate_limits(updated_at);

CREATE TABLE moderation_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX moderation_audit_logs_target_idx
  ON moderation_audit_logs(target_type, target_id, created_at DESC);

CREATE INDEX moderation_audit_logs_actor_idx
  ON moderation_audit_logs(actor_user_id, created_at DESC);

CREATE TABLE operational_events (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
  route TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status_code INTEGER,
  actor_user_id TEXT,
  target_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX operational_events_route_created_idx
  ON operational_events(route, created_at DESC);

CREATE INDEX operational_events_severity_created_idx
  ON operational_events(severity, created_at DESC);
