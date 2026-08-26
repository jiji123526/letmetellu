/* Measure current reply fan-out without selecting message or DM content. */
WITH public_fanout AS (
  SELECT channel_id, reply_to AS root_id, COUNT(*) AS child_count
  FROM messages
  WHERE reply_to IS NOT NULL
    AND deleted = 0
  GROUP BY channel_id, reply_to
)
SELECT
  COUNT(*) AS public_roots_with_replies,
  ROUND(AVG(child_count), 2) AS average_public_children,
  MAX(child_count) AS maximum_public_children,
  SUM(child_count > 300) AS roots_above_item_budget
FROM public_fanout;

WITH dm_fanout AS (
  SELECT channel_id, dm_id AS root_id, COUNT(*) AS child_count
  FROM dm_replies
  WHERE pending_delete_at IS NULL
  GROUP BY channel_id, dm_id
)
SELECT
  COUNT(*) AS dm_roots_with_replies,
  ROUND(AVG(child_count), 2) AS average_dm_children,
  MAX(child_count) AS maximum_dm_children,
  SUM(child_count > 20) AS roots_above_product_limit
FROM dm_fanout;

WITH combined_fanout AS (
  SELECT 'message' AS source, COUNT(*) AS child_count
  FROM messages
  WHERE reply_to IS NOT NULL
    AND deleted = 0
  GROUP BY channel_id, reply_to
  UNION ALL
  SELECT 'dm' AS source, COUNT(*) AS child_count
  FROM dm_replies
  WHERE pending_delete_at IS NULL
  GROUP BY channel_id, dm_id
)
SELECT
  source,
  SUM(child_count BETWEEN 1 AND 10) AS roots_1_to_10,
  SUM(child_count BETWEEN 11 AND 50) AS roots_11_to_50,
  SUM(child_count BETWEEN 51 AND 100) AS roots_51_to_100,
  SUM(child_count BETWEEN 101 AND 300) AS roots_101_to_300,
  SUM(child_count > 300) AS roots_above_300
FROM combined_fanout
GROUP BY source
ORDER BY source;

/* Owner root candidates should use dm_channel_created_idx. */
EXPLAIN QUERY PLAN
SELECT *
FROM dm
WHERE channel_id = '__index_audit__'
  AND pending_delete_at IS NULL
ORDER BY created_at DESC, id DESC
LIMIT 51;

/* Visitor root candidates should use dm_channel_uid_created_idx. */
EXPLAIN QUERY PLAN
SELECT *
FROM dm
WHERE channel_id = '__index_audit__'
  AND uid = '__visitor_audit__'
  AND pending_delete_at IS NULL
ORDER BY created_at DESC, id DESC
LIMIT 51;

/* Public root candidates and child expansion must remain indexed. */
EXPLAIN QUERY PLAN
SELECT *
FROM messages
WHERE channel_id = '__index_audit__'
  AND reply_to IS NULL
  AND (
    deleted = 0
    OR (
      deleted = 1
      AND EXISTS (
        SELECT 1
        FROM messages child
        WHERE child.channel_id = '__index_audit__'
          AND child.deleted = 0
          AND child.reply_to = messages.id
      )
    )
  )
ORDER BY created_at DESC, id DESC
LIMIT 51;

EXPLAIN QUERY PLAN
SELECT *
FROM messages
WHERE channel_id = '__index_audit__'
  AND reply_to IN ('__root_a__', '__root_b__')
  AND deleted = 0
ORDER BY created_at ASC, id ASC;
