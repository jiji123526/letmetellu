CREATE TABLE channel_moderation (
  channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'warned', 'suspended', 'frozen')),
  warning_sent_at TEXT,
  warned_report_count INTEGER NOT NULL DEFAULT 0,
  suspension_notice_sent_at TEXT,
  suspension_reason TEXT,
  frozen_at TEXT,
  frozen_by TEXT,
  petition_status TEXT NOT NULL DEFAULT 'none'
    CHECK (petition_status IN ('none', 'open', 'accepted', 'rejected')),
  current_petition_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE channel_petitions (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  owner_uid TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'rejected')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_note TEXT,
  inbox_message_id TEXT
);

CREATE INDEX channel_petitions_channel_created_idx
  ON channel_petitions(channel_id, created_at DESC);

CREATE INDEX channel_petitions_status_idx
  ON channel_petitions(channel_id, status);
