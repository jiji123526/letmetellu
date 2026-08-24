ALTER TABLE dm ADD COLUMN activity_at TEXT;

UPDATE dm
SET activity_at = COALESCE(
  (
    SELECT MAX(dm_replies.created_at)
    FROM dm_replies
    WHERE dm_replies.dm_id = dm.id
  ),
  created_at
);

CREATE TRIGGER dm_set_activity_at_after_insert
AFTER INSERT ON dm
WHEN NEW.activity_at IS NULL
BEGIN
  UPDATE dm
  SET activity_at = NEW.created_at
  WHERE id = NEW.id;
END;

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

CREATE INDEX dm_channel_activity_idx
  ON dm(channel_id, activity_at DESC, id DESC);

CREATE INDEX dm_channel_uid_activity_idx
  ON dm(channel_id, uid, activity_at DESC, id DESC);
