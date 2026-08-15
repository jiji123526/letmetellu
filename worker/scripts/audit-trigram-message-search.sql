SELECT sql
FROM sqlite_master
WHERE type = 'table' AND name = 'messages_fts';

SELECT name, sql
FROM sqlite_master
WHERE type = 'trigger' AND name IN ('messages_ai', 'messages_ad', 'messages_au')
ORDER BY name;

INSERT INTO messages_fts(messages_fts) VALUES('integrity-check');

EXPLAIN QUERY PLAN
SELECT m.id, m.text, m.created_at
FROM messages_fts
INNER JOIN messages m ON m.rowid = messages_fts.rowid
WHERE messages_fts MATCH '"__trigram_search_audit__"'
  AND m.channel_id = '__trigram_search_audit__'
  AND m.deleted = 0
ORDER BY m.created_at DESC, m.id DESC
LIMIT 31;
