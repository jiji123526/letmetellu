PRAGMA index_info('messages_reply_to_idx');

-- This is the child lookup SQLite performs for
-- FOREIGN KEY (reply_to) REFERENCES messages(id) ON DELETE SET NULL.
EXPLAIN QUERY PLAN
SELECT id
FROM messages
WHERE reply_to = '__message_delete_audit__';

PRAGMA foreign_key_check;
