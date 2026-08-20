PRAGMA index_info('gallery_channel_created_id_idx');

SELECT
  (SELECT COUNT(*)
   FROM gallery g
   WHERE NOT EXISTS (
     SELECT 1
     FROM messages m
     WHERE m.channel_id = g.channel_id
       AND m.gallery_id = g.id
       AND m.deleted = 0
       AND m.image IS NOT NULL
   )) AS orphan_gallery_rows,
  (SELECT COUNT(*)
   FROM messages m
   WHERE m.deleted = 0
     AND m.gallery_id IS NOT NULL
     AND m.image IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM gallery g
       WHERE g.channel_id = m.channel_id
         AND g.id = m.gallery_id
     )) AS missing_gallery_rows;

SELECT name
FROM sqlite_schema
WHERE type = 'trigger'
  AND name IN (
    'messages_gallery_after_insert',
    'messages_gallery_after_update',
    'messages_gallery_after_delete'
  )
ORDER BY name;

EXPLAIN QUERY PLAN
SELECT id, image, auth_uid, channel_id, created_at
FROM gallery
WHERE channel_id = '__index_audit__'
ORDER BY created_at DESC, id DESC
LIMIT 50;

EXPLAIN QUERY PLAN
SELECT id, image, auth_uid, channel_id, created_at
FROM gallery
WHERE channel_id = '__index_audit__'
  AND (created_at, id) < (
    '9999-12-31T23:59:59.999Z',
    '__cursor_id__'
  )
ORDER BY created_at DESC, id DESC
LIMIT 50;
