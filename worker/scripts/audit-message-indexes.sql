-- Run against production before removing any messages index:
-- npx wrangler d1 execute letsplay-db --remote \
--   --file scripts/audit-message-indexes.sql

PRAGMA index_list('messages');

PRAGMA index_info('messages_channel_idx');
PRAGMA index_info('messages_channel_created_id_idx');
PRAGMA index_info('messages_channel_reply_deleted_idx');
PRAGMA index_info('messages_channel_deleted_reply_idx');
PRAGMA index_info('messages_channel_deleted_created_id_idx');
PRAGMA index_info('messages_client_message_id_idx');

-- Normal newest-page read. The created_at/id ordering should use
-- messages_channel_created_id_idx after messages_channel_idx is removed.
EXPLAIN QUERY PLAN
SELECT *
FROM messages
WHERE channel_id = '__index_audit__'
  AND (
    deleted = 0
    OR (
      deleted = 1
      AND id IN (
        SELECT reply_to
        FROM messages
        WHERE channel_id = '__index_audit__'
          AND deleted = 0
          AND reply_to IS NOT NULL
      )
    )
  )
ORDER BY created_at DESC, id DESC
LIMIT 51;

-- Dashboard latest-visible-message lookup.
EXPLAIN QUERY PLAN
SELECT created_at
FROM messages
WHERE channel_id = '__index_audit__'
  AND deleted = 0
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- Direct visible-child expansion.
EXPLAIN QUERY PLAN
SELECT *
FROM messages
WHERE channel_id = '__index_audit__'
  AND reply_to IN ('__root_a__', '__root_b__')
  AND deleted = 0;

-- Deleted-root visibility subquery.
EXPLAIN QUERY PLAN
SELECT reply_to
FROM messages
WHERE channel_id = '__index_audit__'
  AND deleted = 0
  AND reply_to IS NOT NULL;

-- Moderation thread deletion lookup.
EXPLAIN QUERY PLAN
SELECT id
FROM messages
WHERE reply_to = '__root_a__'
  AND channel_id = '__index_audit__';
