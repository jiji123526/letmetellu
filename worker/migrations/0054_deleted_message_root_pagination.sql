-- Keeps sparse history edges from scanning active roots while checking the
-- remaining deleted parents that are visible through active replies.
CREATE INDEX IF NOT EXISTS messages_deleted_root_page_idx
  ON messages(channel_id, created_at DESC, id DESC)
  WHERE reply_to IS NULL AND deleted = 1;
