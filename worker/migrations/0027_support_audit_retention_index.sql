CREATE INDEX IF NOT EXISTS support_audit_logs_created_at_idx
  ON support_audit_logs(created_at DESC);
