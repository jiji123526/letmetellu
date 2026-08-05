-- Supports latest visible-message lookups and ordered channel search scans.
CREATE INDEX IF NOT EXISTS messages_channel_deleted_created_id_idx
  ON messages(channel_id, deleted, created_at DESC, id DESC);
