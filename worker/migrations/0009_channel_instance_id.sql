ALTER TABLE channels ADD COLUMN instance_id TEXT;

UPDATE channels
SET instance_id = lower(hex(randomblob(16)))
WHERE instance_id IS NULL;
