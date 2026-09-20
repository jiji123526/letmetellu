ALTER TABLE blocked ADD COLUMN mode TEXT NOT NULL DEFAULT 'send_only'
  CHECK (mode IN ('send_only', 'deny_entry'));

CREATE INDEX IF NOT EXISTS idx_blocked_channel_mode_uid
  ON blocked(channel_id, uid, mode);

CREATE INDEX IF NOT EXISTS idx_blocked_channel_mode_device
  ON blocked(channel_id, device_id, mode);
