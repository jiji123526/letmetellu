CREATE TABLE IF NOT EXISTS support_thread_reads (
  thread_id TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('user', 'platform_admin')),
  read_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, actor_role)
);

CREATE INDEX IF NOT EXISTS support_thread_reads_actor_idx
  ON support_thread_reads(actor_role, read_at DESC);

CREATE TABLE IF NOT EXISTS support_audit_logs (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('user', 'platform_admin', 'system')),
  actor_user_id TEXT,
  action TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS support_audit_logs_thread_idx
  ON support_audit_logs(thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS support_audit_logs_action_idx
  ON support_audit_logs(action, created_at DESC);
