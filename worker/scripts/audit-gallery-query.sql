PRAGMA index_info('gallery_channel_created_id_idx');
PRAGMA index_info('messages_visible_gallery_lookup_idx');

EXPLAIN QUERY PLAN
SELECT
  m.id AS id,
  g.image,
  g.auth_uid,
  g.channel_id,
  g.created_at
FROM gallery g
CROSS JOIN messages m
WHERE g.channel_id = '__index_audit__'
  AND m.channel_id = g.channel_id
  AND m.gallery_id = g.id
  AND m.deleted = 0
ORDER BY g.created_at DESC, g.id DESC
LIMIT 50;

EXPLAIN QUERY PLAN
SELECT
  m.id AS id,
  g.image,
  g.auth_uid,
  g.channel_id,
  g.created_at
FROM gallery g
CROSS JOIN messages m
WHERE g.channel_id = '__index_audit__'
  AND m.channel_id = g.channel_id
  AND m.gallery_id = g.id
  AND m.deleted = 0
  AND (
    g.created_at < '9999-12-31T23:59:59.999Z'
    OR (
      g.created_at = '9999-12-31T23:59:59.999Z'
      AND g.id < '__cursor_id__'
    )
  )
ORDER BY g.created_at DESC, g.id DESC
LIMIT 50;
