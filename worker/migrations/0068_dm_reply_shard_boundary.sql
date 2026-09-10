-- A Chat shard does not own account rows. Keep the shard-local DM and channel
-- foreign keys, but do not require a copy of the control-plane users table.
CREATE TABLE dm_replies_shard_boundary (
  id TEXT PRIMARY KEY,
  client_reply_id TEXT NOT NULL,
  dm_id TEXT NOT NULL REFERENCES dm(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  owner_uid TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  pending_delete_at TEXT,
  image TEXT,
  image_w INTEGER,
  image_h INTEGER,
  UNIQUE(owner_uid, client_reply_id)
);

INSERT INTO dm_replies_shard_boundary (
  id,
  client_reply_id,
  dm_id,
  channel_id,
  owner_uid,
  text,
  created_at,
  pending_delete_at,
  image,
  image_w,
  image_h
)
SELECT
  id,
  client_reply_id,
  dm_id,
  channel_id,
  owner_uid,
  text,
  created_at,
  pending_delete_at,
  image,
  image_w,
  image_h
FROM dm_replies;

DROP TABLE dm_replies;
ALTER TABLE dm_replies_shard_boundary RENAME TO dm_replies;

CREATE INDEX dm_replies_dm_created_idx
  ON dm_replies(dm_id, created_at, id);

CREATE TRIGGER dm_bump_activity_at_after_reply
AFTER INSERT ON dm_replies
BEGIN
  UPDATE dm
  SET activity_at = CASE
    WHEN activity_at IS NULL OR activity_at < NEW.created_at
      THEN NEW.created_at
    ELSE activity_at
  END
  WHERE id = NEW.dm_id;
END;
