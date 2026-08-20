-- Keeps the common active-root branch bounded without indexing replies or
-- deleted roots that cannot fill a normal history page.
CREATE INDEX IF NOT EXISTS messages_active_root_page_idx
  ON messages(channel_id, created_at DESC, id DESC)
  WHERE reply_to IS NULL AND deleted = 0;
