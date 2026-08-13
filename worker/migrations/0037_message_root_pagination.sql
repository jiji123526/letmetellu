-- Keeps root-owned message windows ordered without scanning reply activity.
CREATE INDEX IF NOT EXISTS messages_channel_root_created_id_idx
  ON messages(channel_id, reply_to, created_at DESC, id DESC);
