-- Run after migration 0041:
-- npx wrangler d1 execute letsplay-db --remote \
--   --command "$(cat scripts/audit-query-read-optimizations.sql)"

PRAGMA index_info('message_actor_identities_created_idx');

EXPLAIN QUERY PLAN
SELECT rowid
FROM message_actor_identities
WHERE created_at < '2000-01-01T00:00:00.000Z'
ORDER BY created_at ASC
LIMIT 250;

EXPLAIN QUERY PLAN
SELECT *
FROM (
  SELECT *
  FROM messages
  WHERE channel_id = '__index_audit__'
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
    AND reply_to IS NULL
    AND (created_at, id) < ('2000-01-01T00:00:00.000Z', '__cursor_id__')
  ORDER BY created_at DESC, id DESC
  LIMIT 51
)
ORDER BY created_at ASC, id ASC;

EXPLAIN QUERY PLAN
SELECT *
FROM messages
WHERE id IN ('__root_a__', '__root_b__')
  AND channel_id = '__index_audit__'
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
ORDER BY created_at ASC, id ASC;
