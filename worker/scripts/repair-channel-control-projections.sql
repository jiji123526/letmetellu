-- Pre-canary repair only. Once canonical channels live on physical Chat
-- shards, repair must consume versioned shard events or a bounded shard
-- reconciliation workflow instead of treating control.channels as canonical.
INSERT INTO channel_control_projections (
  channel_id,
  owner_uid,
  show_on_profile,
  created_at,
  projection_version,
  projected_at,
  source_version
)
SELECT
  id,
  owner_uid,
  COALESCE(show_on_profile, 0),
  created_at,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  projection_source_version
FROM channels
WHERE id NOT LIKE '%_live'
ON CONFLICT(channel_id) DO UPDATE SET
  owner_uid = excluded.owner_uid,
  show_on_profile = excluded.show_on_profile,
  created_at = excluded.created_at,
  projection_version = channel_control_projections.projection_version + 1,
  projected_at = excluded.projected_at,
  source_version = excluded.source_version
WHERE channel_control_projections.owner_uid != excluded.owner_uid
   OR channel_control_projections.show_on_profile != excluded.show_on_profile
   OR COALESCE(channel_control_projections.created_at, '') != COALESCE(excluded.created_at, '')
   OR channel_control_projections.source_version != excluded.source_version;

DELETE FROM channel_control_projections
WHERE channel_id LIKE '%_live'
   OR NOT EXISTS (
     SELECT 1
     FROM channels
     WHERE channels.id = channel_control_projections.channel_id
   );
