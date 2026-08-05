ALTER TABLE support_threads ADD COLUMN user_acknowledged_at TEXT;

CREATE INDEX IF NOT EXISTS support_threads_user_acknowledgement_idx
  ON support_threads(user_id, status, user_acknowledged_at, updated_at DESC);
