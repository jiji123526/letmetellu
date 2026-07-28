CREATE TABLE upload_tickets (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  uid TEXT,
  auth_uid TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('message', 'dm', 'channel-asset')),
  ip_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'attached', 'cancelled')),
  attached_record_id TEXT,
  attached_record_type TEXT CHECK (attached_record_type IN ('message', 'dm', 'channel-asset')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX upload_tickets_channel_uid_created_idx
  ON upload_tickets(channel_id, uid, created_at);

CREATE INDEX upload_tickets_channel_ip_created_idx
  ON upload_tickets(channel_id, ip_hash, created_at);

CREATE INDEX upload_tickets_status_expires_idx
  ON upload_tickets(status, expires_at);

CREATE INDEX upload_tickets_attachment_idx
  ON upload_tickets(attached_record_type, attached_record_id);
