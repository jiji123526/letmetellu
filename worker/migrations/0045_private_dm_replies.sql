-- Keep owner replies private while allowing each anonymous sender to reload
-- their own DM threads from the signed browser identity.
CREATE TABLE dm_replies (
  id TEXT PRIMARY KEY,
  client_reply_id TEXT NOT NULL,
  dm_id TEXT NOT NULL REFERENCES dm(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  owner_uid TEXT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(owner_uid, client_reply_id)
);

CREATE INDEX dm_replies_dm_created_idx
  ON dm_replies(dm_id, created_at, id);

CREATE INDEX dm_channel_uid_created_idx
  ON dm(channel_id, uid, created_at DESC, id DESC);
