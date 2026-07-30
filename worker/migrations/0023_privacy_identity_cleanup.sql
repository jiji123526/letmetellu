ALTER TABLE blocked ADD COLUMN device_id TEXT;

UPDATE blocked
SET device_id = fingerprint
WHERE device_id IS NULL AND fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS blocked_channel_device_id_idx
  ON blocked(channel_id, device_id);

UPDATE messages
SET fingerprint = NULL
WHERE fingerprint IS NOT NULL;
