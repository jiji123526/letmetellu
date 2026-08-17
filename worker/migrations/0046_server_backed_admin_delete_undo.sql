-- Keep owner deletion durable across refresh while preserving a short,
-- server-enforced undo window.
CREATE TABLE pending_admin_deletions (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  owner_uid TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('message', 'dm', 'dm_reply')),
  root_id TEXT NOT NULL,
  record_ids_json TEXT NOT NULL,
  previous_states_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX pending_admin_deletions_expires_idx
  ON pending_admin_deletions(expires_at, id);

CREATE INDEX pending_admin_deletions_owner_idx
  ON pending_admin_deletions(owner_uid, channel_id, created_at DESC);

ALTER TABLE dm ADD COLUMN pending_delete_at TEXT;
ALTER TABLE dm_replies ADD COLUMN pending_delete_at TEXT;

