-- Read-only canary Chat-shard audit. This intentionally does not select event
-- payloads, passcodes, moderation state, messages, or media.
PRAGMA quick_check;
PRAGMA foreign_key_check;

SELECT
  shard_role,
  bootstrap_version,
  bootstrapped_at
FROM chat_shard_metadata
WHERE id = 1;

SELECT
  name,
  type
FROM sqlite_schema
WHERE name IN (
  'channels',
  'channel_control_projections',
  'channel_projection_versions',
  'domain_events',
  'domain_events_attempt_ready_idx',
  'domain_events_lease_ready_idx',
  'domain_events_delivered_updated_idx',
  'domain_events_dead_updated_idx'
)
ORDER BY type, name;

SELECT
  name,
  CASE WHEN sql LIKE '%domain_events%' THEN 1 ELSE 0 END AS emits_domain_events,
  CASE WHEN sql LIKE '%channel_projection_versions%' THEN 1 ELSE 0 END AS advances_watermark,
  CASE WHEN sql LIKE '%channel_control_projections%' THEN 1 ELSE 0 END AS writes_local_projection
FROM sqlite_schema
WHERE type = 'trigger'
  AND name IN (
    'channel_control_projection_insert',
    'channel_control_projection_update',
    'channel_control_projection_delete'
  )
ORDER BY name;

SELECT
  COUNT(*) AS local_projection_rows
FROM channel_control_projections;

SELECT
  COUNT(*) AS active_channels_missing_watermark
FROM channels AS channel
LEFT JOIN channel_projection_versions AS version
  ON version.channel_id = channel.id
WHERE channel.id NOT LIKE '%_live'
  AND (
    version.channel_id IS NULL
    OR version.state != 'active'
    OR version.source_version != channel.projection_source_version
  );

SELECT
  status,
  COUNT(*) AS rows,
  MIN(created_at) AS oldest_created_at,
  MAX(updated_at) AS newest_updated_at
FROM domain_events
GROUP BY status
ORDER BY status;

SELECT
  channel_id,
  event_type,
  source_version,
  status,
  attempt_count,
  created_at
FROM domain_events
WHERE status IN ('pending', 'processing', 'dead')
ORDER BY created_at ASC, id ASC
LIMIT 100;
