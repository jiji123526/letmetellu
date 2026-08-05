CREATE INDEX IF NOT EXISTS support_threads_status_updated_id_idx
  ON support_threads(status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS support_messages_thread_created_id_role_idx
  ON support_messages(thread_id, created_at DESC, id DESC, sender_role);

CREATE INDEX IF NOT EXISTS support_messages_thread_role_created_id_idx
  ON support_messages(thread_id, sender_role, created_at DESC, id DESC);

DROP INDEX IF EXISTS support_threads_status_updated_idx;
DROP INDEX IF EXISTS support_messages_thread_idx;
