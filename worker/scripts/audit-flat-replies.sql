SELECT
  COUNT(*) AS total_messages,
  SUM(CASE WHEN reply_to IS NOT NULL THEN 1 ELSE 0 END) AS total_replies,
  SUM(CASE WHEN reply_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM messages parent WHERE parent.id = messages.reply_to
  ) THEN 1 ELSE 0 END) AS broken_parent_refs,
  SUM(CASE WHEN reply_to IS NOT NULL AND EXISTS (
    SELECT 1 FROM messages parent
    WHERE parent.id = messages.reply_to AND parent.channel_id != messages.channel_id
  ) THEN 1 ELSE 0 END) AS cross_channel_refs,
  SUM(CASE WHEN reply_to IS NOT NULL AND EXISTS (
    SELECT 1 FROM messages parent
    WHERE parent.id = messages.reply_to
      AND parent.channel_id = messages.channel_id
      AND parent.reply_to IS NOT NULL
  ) THEN 1 ELSE 0 END) AS nested_replies
FROM messages;

WITH RECURSIVE walk(start_id, channel_id, id, reply_to, path, cycle, depth) AS (
  SELECT id, channel_id, id, reply_to, '|' || id || '|', 0, 0
  FROM messages
  WHERE reply_to IS NOT NULL
  UNION ALL
  SELECT walk.start_id, walk.channel_id, parent.id, parent.reply_to,
         walk.path || parent.id || '|',
         CASE WHEN instr(walk.path, '|' || parent.id || '|') > 0 THEN 1 ELSE 0 END,
         walk.depth + 1
  FROM walk
  INNER JOIN messages parent
    ON parent.id = walk.reply_to AND parent.channel_id = walk.channel_id
  WHERE walk.reply_to IS NOT NULL AND walk.cycle = 0 AND walk.depth < 100
)
SELECT
  COUNT(DISTINCT CASE WHEN cycle = 1 THEN start_id END) AS cyclic_reply_chains,
  MAX(depth) AS max_observed_depth,
  COUNT(DISTINCT CASE WHEN depth = 100 AND reply_to IS NOT NULL THEN start_id END) AS over_depth_limit
FROM walk;

SELECT child.channel_id, COUNT(*) AS nested_replies
FROM messages child
INNER JOIN messages parent
  ON parent.id = child.reply_to AND parent.channel_id = child.channel_id
WHERE parent.reply_to IS NOT NULL
GROUP BY child.channel_id
ORDER BY nested_replies DESC
LIMIT 20;
