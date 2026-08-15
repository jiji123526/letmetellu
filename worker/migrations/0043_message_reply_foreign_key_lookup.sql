-- Supports SQLite foreign-key child lookup when deleting a parent message.
-- Existing reply indexes begin with channel_id and cannot serve WHERE reply_to = ? alone.
CREATE INDEX IF NOT EXISTS messages_reply_to_idx
  ON messages(reply_to);
