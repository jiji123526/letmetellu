ALTER TABLE gallery ADD COLUMN message_id TEXT;

UPDATE gallery
SET message_id = (
  SELECT messages.id
  FROM messages
  WHERE messages.channel_id = gallery.channel_id
    AND messages.gallery_id = gallery.id
    AND messages.deleted = 0
    AND messages.image IS NOT NULL
  LIMIT 1
);

DELETE FROM gallery
WHERE message_id IS NULL;

DROP TRIGGER IF EXISTS messages_gallery_after_insert;
DROP TRIGGER IF EXISTS messages_gallery_after_update;
DROP TRIGGER IF EXISTS messages_gallery_after_delete;

CREATE TRIGGER messages_gallery_after_insert
AFTER INSERT ON messages
WHEN NEW.deleted = 0
  AND NEW.gallery_id IS NOT NULL
  AND NEW.image IS NOT NULL
BEGIN
  INSERT OR REPLACE INTO gallery (
    id, message_id, image, auth_uid, channel_id, created_at
  ) VALUES (
    NEW.gallery_id, NEW.id, NEW.image, NEW.auth_uid, NEW.channel_id, NEW.created_at
  );
END;

CREATE TRIGGER messages_gallery_after_update
AFTER UPDATE OF deleted, gallery_id, image, auth_uid ON messages
WHEN OLD.gallery_id IS NOT NULL OR NEW.gallery_id IS NOT NULL
BEGIN
  DELETE FROM gallery
  WHERE channel_id = OLD.channel_id
    AND (id = OLD.gallery_id OR message_id = OLD.id);

  INSERT OR REPLACE INTO gallery (
    id, message_id, image, auth_uid, channel_id, created_at
  )
  SELECT
    NEW.gallery_id, NEW.id, NEW.image, NEW.auth_uid, NEW.channel_id, NEW.created_at
  WHERE NEW.deleted = 0
    AND NEW.gallery_id IS NOT NULL
    AND NEW.image IS NOT NULL;
END;

CREATE TRIGGER messages_gallery_after_delete
AFTER DELETE ON messages
WHEN OLD.gallery_id IS NOT NULL
BEGIN
  DELETE FROM gallery
  WHERE channel_id = OLD.channel_id
    AND (id = OLD.gallery_id OR message_id = OLD.id);
END;

DROP INDEX IF EXISTS gallery_channel_created_id_idx;

CREATE INDEX gallery_channel_created_message_idx
  ON gallery(channel_id, created_at DESC, message_id DESC);

CREATE UNIQUE INDEX gallery_channel_message_id_idx
  ON gallery(channel_id, message_id);
