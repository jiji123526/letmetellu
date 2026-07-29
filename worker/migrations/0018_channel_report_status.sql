ALTER TABLE channel_reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE channel_reports ADD COLUMN resolution_note TEXT;
ALTER TABLE channel_reports ADD COLUMN resolved_at TEXT;
ALTER TABLE channel_reports ADD COLUMN inbox_message_id TEXT;

CREATE INDEX channel_reports_inbox_message_idx
  ON channel_reports(inbox_message_id);

CREATE INDEX channel_reports_status_created_idx
  ON channel_reports(status, created_at DESC);
