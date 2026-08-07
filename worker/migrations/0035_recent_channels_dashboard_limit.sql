DROP INDEX IF EXISTS user_recent_channels_user_visited_idx;

CREATE INDEX IF NOT EXISTS user_recent_channels_user_pinned_visited_idx
  ON user_recent_channels(user_id, pinned DESC, last_visited_at DESC, channel_id DESC);

DELETE FROM user_recent_channels
WHERE rowid IN (
  SELECT rowid FROM (
    SELECT
      rowid,
      ROW_NUMBER() OVER (
        PARTITION BY user_id
        ORDER BY pinned DESC, last_visited_at DESC, channel_id DESC
      ) AS row_num
    FROM user_recent_channels
  )
  WHERE row_num > 100
);
