CREATE TABLE IF NOT EXISTS user_recent_channels (
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  last_visited_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  bubble_color TEXT,
  PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS user_recent_channels_user_visited_idx
  ON user_recent_channels(user_id, last_visited_at DESC);

CREATE INDEX IF NOT EXISTS user_recent_channels_channel_idx
  ON user_recent_channels(channel_id);
