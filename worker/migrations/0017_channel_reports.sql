CREATE TABLE channel_reports (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  reporter_uid TEXT NOT NULL,
  reporter_auth_uid TEXT,
  reporter_device_id TEXT,
  reason TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX channel_reports_channel_created_idx
  ON channel_reports(channel_id, created_at DESC);

CREATE INDEX channel_reports_auth_reporter_idx
  ON channel_reports(reporter_auth_uid, channel_id, created_at DESC);

CREATE INDEX channel_reports_anon_reporter_idx
  ON channel_reports(reporter_uid, reporter_device_id, channel_id, created_at DESC);
