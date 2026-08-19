SELECT
  COUNT(*) AS total_messages,
  SUM(CASE WHEN root_id IS NULL THEN 1 ELSE 0 END) AS unresolved_roots,
  SUM(CASE WHEN reply_to IS NULL AND root_id != id THEN 1 ELSE 0 END) AS invalid_root_rows
FROM messages;

SELECT COUNT(*) AS invalid_root_references
FROM messages AS message
LEFT JOIN messages AS root
  ON root.id = message.root_id
 AND root.channel_id = message.channel_id
WHERE message.root_id IS NOT NULL
  AND (root.id IS NULL OR root.reply_to IS NOT NULL);

EXPLAIN QUERY PLAN
SELECT root_id AS id
FROM messages
WHERE id = 'audit-message-id'
  AND channel_id = 'audit-channel-id'
  AND deleted = 0
  AND root_id IS NOT NULL
LIMIT 1;
