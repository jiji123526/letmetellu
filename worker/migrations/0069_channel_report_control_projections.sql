-- Non-authoritative platform-admin projection for channel-local reports.
-- Existing report routes continue using channel_reports until the durable
-- shard event producer and consumer are enabled in later rollout steps.
ALTER TABLE channel_reports
  ADD COLUMN projection_source_version INTEGER NOT NULL DEFAULT 1
  CHECK (projection_source_version > 0);

CREATE TABLE channel_report_control_projections (
  report_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_owner_uid TEXT NOT NULL,
  reporter_uid TEXT NOT NULL,
  reporter_auth_uid TEXT,
  reporter_device_id TEXT,
  reason TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  resolution_note TEXT,
  resolved_at TEXT,
  inbox_message_id TEXT,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  projected_at TEXT NOT NULL
);

CREATE INDEX channel_report_control_status_created_idx
  ON channel_report_control_projections(status, created_at DESC, report_id DESC);

CREATE INDEX channel_report_control_channel_created_idx
  ON channel_report_control_projections(channel_id, created_at DESC, report_id DESC);

CREATE INDEX channel_report_control_inbox_message_idx
  ON channel_report_control_projections(inbox_message_id)
  WHERE inbox_message_id IS NOT NULL;

CREATE TABLE channel_report_projection_watermarks (
  report_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  state TEXT NOT NULL CHECK (state IN ('active', 'deleted')),
  updated_at TEXT NOT NULL
);

CREATE INDEX channel_report_projection_watermarks_channel_idx
  ON channel_report_projection_watermarks(channel_id, updated_at DESC, report_id DESC);

INSERT INTO channel_report_control_projections (
  report_id,
  channel_id,
  channel_name,
  channel_owner_uid,
  reporter_uid,
  reporter_auth_uid,
  reporter_device_id,
  reason,
  details,
  created_at,
  status,
  resolution_note,
  resolved_at,
  inbox_message_id,
  source_version,
  projected_at
)
SELECT
  report.id,
  report.channel_id,
  channel.name,
  channel.owner_uid,
  report.reporter_uid,
  report.reporter_auth_uid,
  report.reporter_device_id,
  report.reason,
  report.details,
  report.created_at,
  report.status,
  report.resolution_note,
  report.resolved_at,
  report.inbox_message_id,
  report.projection_source_version,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM channel_reports AS report
INNER JOIN channels AS channel ON channel.id = report.channel_id;

INSERT INTO channel_report_projection_watermarks (
  report_id,
  channel_id,
  source_version,
  state,
  updated_at
)
SELECT
  report.id,
  report.channel_id,
  report.projection_source_version,
  'active',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM channel_reports AS report;
