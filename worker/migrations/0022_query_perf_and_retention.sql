CREATE INDEX IF NOT EXISTS messages_channel_created_id_idx
  ON messages(channel_id, created_at, id);

CREATE INDEX IF NOT EXISTS messages_channel_deleted_reply_idx
  ON messages(channel_id, deleted, reply_to);

CREATE INDEX IF NOT EXISTS upload_tickets_channel_uid_purpose_created_idx
  ON upload_tickets(channel_id, uid, purpose, created_at);

CREATE INDEX IF NOT EXISTS upload_tickets_channel_ip_purpose_created_idx
  ON upload_tickets(channel_id, ip_hash, purpose, created_at);

CREATE INDEX IF NOT EXISTS upload_tickets_channel_uid_purpose_status_expires_idx
  ON upload_tickets(channel_id, uid, purpose, status, expires_at);

CREATE INDEX IF NOT EXISTS upload_tickets_channel_ip_purpose_status_expires_idx
  ON upload_tickets(channel_id, ip_hash, purpose, status, expires_at);

CREATE INDEX IF NOT EXISTS moderation_audit_logs_created_idx
  ON moderation_audit_logs(created_at);

CREATE INDEX IF NOT EXISTS operational_events_created_idx
  ON operational_events(created_at);
