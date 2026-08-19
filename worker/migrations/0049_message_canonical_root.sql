ALTER TABLE messages ADD COLUMN root_id TEXT;

WITH RECURSIVE message_roots(id, root_id) AS (
  SELECT id, id
  FROM messages
  WHERE reply_to IS NULL

  UNION ALL

  SELECT child.id, message_roots.root_id
  FROM messages AS child
  INNER JOIN message_roots ON child.reply_to = message_roots.id
)
UPDATE messages
SET root_id = (
  SELECT message_roots.root_id
  FROM message_roots
  WHERE message_roots.id = messages.id
)
WHERE EXISTS (
  SELECT 1
  FROM message_roots
  WHERE message_roots.id = messages.id
);
