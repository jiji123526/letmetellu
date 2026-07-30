CREATE TABLE IF NOT EXISTS message_actor_identities (
  record_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  device_id_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (record_id, record_type)
);

CREATE INDEX IF NOT EXISTS message_actor_identities_channel_lookup_idx
  ON message_actor_identities(channel_id, record_type, record_id);

CREATE INDEX IF NOT EXISTS message_actor_identities_channel_created_idx
  ON message_actor_identities(channel_id, created_at);
