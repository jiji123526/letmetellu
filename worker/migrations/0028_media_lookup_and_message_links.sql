-- Migration: 0028_media_lookup_and_message_links.sql
-- Adds indexed link-message lookup support for the links panel.

CREATE TABLE IF NOT EXISTS message_links (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS message_links_channel_created_idx
  ON message_links(channel_id, created_at DESC, message_id DESC);

INSERT OR IGNORE INTO message_links (message_id, channel_id, created_at)
SELECT id, channel_id, created_at
FROM messages
WHERE deleted = 0
  AND (
    instr(text, 'http://') > 0
    OR instr(text, 'https://') > 0
    OR instr(text, 'www.') > 0
  );
