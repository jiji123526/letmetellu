CREATE TABLE IF NOT EXISTS user_channel_retention_choices (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  retained_channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS user_channel_retention_choices_channel_idx
  ON user_channel_retention_choices(retained_channel_id);
