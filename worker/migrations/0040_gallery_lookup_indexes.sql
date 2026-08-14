-- Keep gallery paging ordered without sorting the channel's visible messages.
CREATE INDEX IF NOT EXISTS gallery_channel_created_id_idx
  ON gallery(channel_id, created_at DESC, id DESC);

-- Contains only active image-message mappings used by gallery visibility checks.
CREATE INDEX IF NOT EXISTS messages_visible_gallery_lookup_idx
  ON messages(channel_id, gallery_id)
  WHERE deleted = 0 AND gallery_id IS NOT NULL;
