-- Indexes for channel initialization and moderation hot paths.
-- Existing messages_channel_idx already supports recent-message ordering.

CREATE INDEX IF NOT EXISTS messages_channel_reply_deleted_idx
  ON messages(channel_id, reply_to, deleted);

CREATE INDEX IF NOT EXISTS blocked_channel_uid_idx
  ON blocked(channel_id, uid);

CREATE INDEX IF NOT EXISTS blocked_channel_fingerprint_idx
  ON blocked(channel_id, fingerprint);

CREATE INDEX IF NOT EXISTS dm_channel_created_idx
  ON dm(channel_id, created_at);
