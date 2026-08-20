PRAGMA index_info('messages_active_root_page_idx');

-- Shows whether deleted roots are common enough to affect the fallback branch.
SELECT
  channel_id,
  COUNT(*) AS root_rows,
  SUM(CASE WHEN deleted = 0 THEN 1 ELSE 0 END) AS active_roots,
  SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END) AS deleted_roots,
  SUM(CASE
    WHEN deleted = 1 AND EXISTS (
      SELECT 1
      FROM messages child
      WHERE child.channel_id = messages.channel_id
        AND child.reply_to = messages.id
        AND child.deleted = 0
    ) THEN 1
    ELSE 0
  END) AS retained_deleted_roots
FROM messages
WHERE reply_to IS NULL
GROUP BY channel_id
ORDER BY root_rows DESC
LIMIT 10;

-- Older-page plan. The active branch should use
-- messages_active_root_page_idx, while the deleted branch should use a
-- bounded range on messages_channel_root_created_id_idx and an indexed child
-- existence probe.
EXPLAIN QUERY PLAN
WITH active_roots AS MATERIALIZED (
  SELECT *
  FROM messages INDEXED BY messages_active_root_page_idx
  WHERE channel_id = '__index_audit__'
    AND deleted = 0
    AND reply_to IS NULL
    AND (created_at, id) < ('9999-12-31T23:59:59.999Z', '__cursor_id__')
  ORDER BY created_at DESC, id DESC
  LIMIT 51
),
active_boundary AS (
  SELECT created_at, id
  FROM active_roots
  WHERE (SELECT COUNT(*) FROM active_roots) = 51
  ORDER BY created_at ASC, id ASC
  LIMIT 1
),
page_boundary AS (
  SELECT created_at, id FROM active_boundary
  UNION ALL
  SELECT '', ''
  LIMIT 1
),
visible_roots AS (
  SELECT * FROM active_roots
  UNION ALL
  SELECT *
  FROM messages
  WHERE channel_id = '__index_audit__'
    AND deleted = 1
    AND reply_to IS NULL
    AND (created_at, id) < ('9999-12-31T23:59:59.999Z', '__cursor_id__')
    AND (created_at, id) >= (SELECT created_at, id FROM page_boundary)
    AND EXISTS (
      SELECT 1
      FROM messages child
      WHERE child.channel_id = '__index_audit__'
        AND child.deleted = 0
        AND child.reply_to = messages.id
    )
)
SELECT *
FROM (
  SELECT *
  FROM visible_roots
  ORDER BY created_at DESC, id DESC
  LIMIT 51
)
ORDER BY created_at ASC, id ASC;

-- Newer-page plan. It should use the same indexes with ascending cursor
-- ranges and an upper page boundary.
EXPLAIN QUERY PLAN
WITH active_roots AS MATERIALIZED (
  SELECT *
  FROM messages INDEXED BY messages_active_root_page_idx
  WHERE channel_id = '__index_audit__'
    AND deleted = 0
    AND reply_to IS NULL
    AND (created_at, id) > ('0000-01-01T00:00:00.000Z', '__cursor_id__')
  ORDER BY created_at ASC, id ASC
  LIMIT 51
),
active_boundary AS (
  SELECT created_at, id
  FROM active_roots
  WHERE (SELECT COUNT(*) FROM active_roots) = 51
  ORDER BY created_at DESC, id DESC
  LIMIT 1
),
page_boundary AS (
  SELECT created_at, id FROM active_boundary
  UNION ALL
  SELECT '9999-12-31T23:59:59.999Z', '~'
  LIMIT 1
),
visible_roots AS (
  SELECT * FROM active_roots
  UNION ALL
  SELECT *
  FROM messages
  WHERE channel_id = '__index_audit__'
    AND deleted = 1
    AND reply_to IS NULL
    AND (created_at, id) > ('0000-01-01T00:00:00.000Z', '__cursor_id__')
    AND (created_at, id) <= (SELECT created_at, id FROM page_boundary)
    AND EXISTS (
      SELECT 1
      FROM messages child
      WHERE child.channel_id = '__index_audit__'
        AND child.deleted = 0
        AND child.reply_to = messages.id
    )
)
SELECT *
FROM (
  SELECT *
  FROM visible_roots
  ORDER BY created_at ASC, id ASC
  LIMIT 51
)
ORDER BY created_at ASC, id ASC;
