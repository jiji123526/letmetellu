SELECT
  status,
  COUNT(*) AS rows,
  MIN(created_at) AS oldest_created_at,
  MAX(updated_at) AS newest_updated_at
FROM domain_events
GROUP BY status
ORDER BY status;

SELECT
  event_type,
  status,
  COUNT(*) AS rows,
  MIN(next_attempt_at) AS oldest_next_attempt_at
FROM domain_events
GROUP BY event_type, status
ORDER BY event_type, status;

SELECT
  COUNT(*) AS invalid_payload_rows
FROM domain_events
WHERE json_valid(payload_json) = 0
   OR length(payload_json) > 16384;

SELECT
  channel_id,
  event_type,
  source_version,
  status,
  attempt_count,
  created_at
FROM domain_events
WHERE status IN ('pending', 'processing', 'dead')
ORDER BY created_at ASC
LIMIT 100;
