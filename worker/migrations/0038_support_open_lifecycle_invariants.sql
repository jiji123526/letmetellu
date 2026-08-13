CREATE UNIQUE INDEX IF NOT EXISTS support_sessions_one_open_per_user_idx
  ON support_sessions(user_id)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS support_threads_one_open_per_user_idx
  ON support_threads(user_id)
  WHERE status = 'open';
