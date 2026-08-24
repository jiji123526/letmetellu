CREATE TABLE dm_notification_owners (
  dm_id TEXT PRIMARY KEY REFERENCES dm(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE INDEX dm_notification_owners_user_idx
  ON dm_notification_owners(user_id, created_at DESC);
