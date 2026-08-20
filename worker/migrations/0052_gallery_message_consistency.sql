-- Reconcile historical rows before making gallery the canonical read surface.
DELETE FROM gallery
WHERE NOT EXISTS (
  SELECT 1
  FROM messages
  WHERE messages.channel_id = gallery.channel_id
    AND messages.gallery_id = gallery.id
    AND messages.deleted = 0
    AND messages.image IS NOT NULL
);

INSERT OR REPLACE INTO gallery (id, image, auth_uid, channel_id, created_at)
SELECT gallery_id, image, auth_uid, channel_id, created_at
FROM messages
WHERE deleted = 0
  AND gallery_id IS NOT NULL
  AND image IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS messages_gallery_after_insert
AFTER INSERT ON messages
WHEN NEW.deleted = 0
  AND NEW.gallery_id IS NOT NULL
  AND NEW.image IS NOT NULL
BEGIN
  INSERT OR REPLACE INTO gallery (id, image, auth_uid, channel_id, created_at)
  VALUES (NEW.gallery_id, NEW.image, NEW.auth_uid, NEW.channel_id, NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS messages_gallery_after_update
AFTER UPDATE OF deleted, gallery_id, image, auth_uid ON messages
WHEN OLD.gallery_id IS NOT NULL OR NEW.gallery_id IS NOT NULL
BEGIN
  DELETE FROM gallery
  WHERE id = OLD.gallery_id
    AND channel_id = OLD.channel_id;

  INSERT OR REPLACE INTO gallery (id, image, auth_uid, channel_id, created_at)
  SELECT NEW.gallery_id, NEW.image, NEW.auth_uid, NEW.channel_id, NEW.created_at
  WHERE NEW.deleted = 0
    AND NEW.gallery_id IS NOT NULL
    AND NEW.image IS NOT NULL;
END;

CREATE TRIGGER IF NOT EXISTS messages_gallery_after_delete
AFTER DELETE ON messages
WHEN OLD.gallery_id IS NOT NULL
BEGIN
  DELETE FROM gallery
  WHERE id = OLD.gallery_id
    AND channel_id = OLD.channel_id;
END;

DROP INDEX IF EXISTS messages_visible_gallery_lookup_idx;
