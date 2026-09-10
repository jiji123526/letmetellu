-- Pre-canary audit: compares the projection with control.channels while that
-- table is still authoritative or synchronously refreshed. It cannot detect
-- divergence from a physical Chat shard.
SELECT
  SUM(CASE WHEN projection.channel_id IS NULL THEN 1 ELSE 0 END) AS missing_rows,
  SUM(CASE
    WHEN projection.channel_id IS NOT NULL
      AND (
        projection.owner_uid != channel.owner_uid
        OR projection.show_on_profile != COALESCE(channel.show_on_profile, 0)
        OR COALESCE(projection.created_at, '') != COALESCE(channel.created_at, '')
        OR projection.source_version != channel.projection_source_version
      )
    THEN 1 ELSE 0
  END) AS mismatched_rows
FROM channels AS channel
LEFT JOIN channel_control_projections AS projection
  ON projection.channel_id = channel.id
WHERE channel.id NOT LIKE '%_live';

SELECT COUNT(*) AS orphaned_rows
FROM channel_control_projections AS projection
LEFT JOIN channels AS channel
  ON channel.id = projection.channel_id
WHERE channel.id IS NULL OR channel.id LIKE '%_live';

SELECT
  projection.channel_id,
  projection.owner_uid AS projected_owner_uid,
  channel.owner_uid AS source_owner_uid,
  projection.show_on_profile AS projected_show_on_profile,
  COALESCE(channel.show_on_profile, 0) AS source_show_on_profile,
  projection.projection_version,
  projection.source_version AS projected_source_version,
  channel.projection_source_version AS source_version,
  projection.projected_at
FROM channel_control_projections AS projection
INNER JOIN channels AS channel
  ON channel.id = projection.channel_id
WHERE projection.owner_uid != channel.owner_uid
   OR projection.show_on_profile != COALESCE(channel.show_on_profile, 0)
   OR COALESCE(projection.created_at, '') != COALESCE(channel.created_at, '')
   OR projection.source_version != channel.projection_source_version
ORDER BY projection.projected_at ASC
LIMIT 100;
