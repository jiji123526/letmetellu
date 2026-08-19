WITH RECURSIVE
  buckets(bucket_start) AS (
    SELECT strftime('%Y-%m-%dT%H:%M:00.000Z', 'now', '-7 days')
    UNION ALL
    SELECT strftime('%Y-%m-%dT%H:%M:00.000Z', bucket_start, '+15 minutes')
    FROM buckets
    WHERE bucket_start < strftime('%Y-%m-%dT%H:%M:00.000Z', 'now', '-15 minutes')
  ),
  bucket_counts AS (
    SELECT
      buckets.bucket_start,
      SUM(CASE WHEN e.event_type = 'request_failed' AND e.status_code >= 500 THEN 1 ELSE 0 END) AS request_5xx_count,
      SUM(CASE WHEN e.event_type = 'unhandled_exception' THEN 1 ELSE 0 END) AS unhandled_exception_count,
      SUM(CASE WHEN e.event_type = 'd1_unavailable' THEN 1 ELSE 0 END) AS d1_unavailable_count,
      SUM(CASE WHEN e.event_type = 'maintenance_failed' THEN 1 ELSE 0 END) AS maintenance_failure_count,
      SUM(CASE WHEN e.event_type = 'cleanup_failed' THEN 1 ELSE 0 END) AS cleanup_failure_count,
      SUM(CASE WHEN e.event_type = 'realtime_unavailable' THEN 1 ELSE 0 END) AS realtime_failure_count,
      SUM(CASE WHEN e.event_type = 'rate_limited' THEN 1 ELSE 0 END) AS rate_limited_count,
      SUM(CASE WHEN e.event_type = 'forbidden' THEN 1 ELSE 0 END) AS forbidden_count,
      SUM(CASE WHEN e.event_type = 'preview_upstream_failed' THEN 1 ELSE 0 END) AS preview_failure_count,
      SUM(CASE WHEN e.event_type = 'media_not_found' THEN 1 ELSE 0 END) AS media_not_found_count
    FROM buckets
    LEFT JOIN operational_events e
      ON e.created_at >= buckets.bucket_start
     AND e.created_at < strftime('%Y-%m-%dT%H:%M:00.000Z', buckets.bucket_start, '+15 minutes')
    GROUP BY buckets.bucket_start
  ),
  ranked AS (
    SELECT
      *,
      CUME_DIST() OVER (ORDER BY request_5xx_count) AS request_5xx_cume,
      CUME_DIST() OVER (ORDER BY unhandled_exception_count) AS exception_cume,
      CUME_DIST() OVER (ORDER BY d1_unavailable_count) AS d1_cume,
      CUME_DIST() OVER (ORDER BY maintenance_failure_count) AS maintenance_cume,
      CUME_DIST() OVER (ORDER BY cleanup_failure_count) AS cleanup_cume,
      CUME_DIST() OVER (ORDER BY realtime_failure_count) AS realtime_cume,
      CUME_DIST() OVER (ORDER BY rate_limited_count) AS rate_limited_cume,
      CUME_DIST() OVER (ORDER BY forbidden_count) AS forbidden_cume,
      CUME_DIST() OVER (ORDER BY preview_failure_count) AS preview_cume,
      CUME_DIST() OVER (ORDER BY media_not_found_count) AS media_not_found_cume
    FROM bucket_counts
  )
SELECT
  COUNT(*) AS fifteen_minute_windows,
  json_object(
    'nonzero', SUM(request_5xx_count > 0),
    'average', ROUND(AVG(request_5xx_count), 3),
    'p50', MIN(CASE WHEN request_5xx_cume >= 0.50 THEN request_5xx_count END),
    'p95', MIN(CASE WHEN request_5xx_cume >= 0.95 THEN request_5xx_count END),
    'p99', MIN(CASE WHEN request_5xx_cume >= 0.99 THEN request_5xx_count END),
    'max', MAX(request_5xx_count)
  ) AS request_5xx,
  json_object(
    'nonzero', SUM(unhandled_exception_count > 0),
    'average', ROUND(AVG(unhandled_exception_count), 3),
    'p50', MIN(CASE WHEN exception_cume >= 0.50 THEN unhandled_exception_count END),
    'p95', MIN(CASE WHEN exception_cume >= 0.95 THEN unhandled_exception_count END),
    'p99', MIN(CASE WHEN exception_cume >= 0.99 THEN unhandled_exception_count END),
    'max', MAX(unhandled_exception_count)
  ) AS unhandled_exception,
  json_object(
    'nonzero', SUM(d1_unavailable_count > 0),
    'average', ROUND(AVG(d1_unavailable_count), 3),
    'p50', MIN(CASE WHEN d1_cume >= 0.50 THEN d1_unavailable_count END),
    'p95', MIN(CASE WHEN d1_cume >= 0.95 THEN d1_unavailable_count END),
    'p99', MIN(CASE WHEN d1_cume >= 0.99 THEN d1_unavailable_count END),
    'max', MAX(d1_unavailable_count)
  ) AS d1_unavailable,
  json_object(
    'nonzero', SUM(maintenance_failure_count > 0),
    'average', ROUND(AVG(maintenance_failure_count), 3),
    'p50', MIN(CASE WHEN maintenance_cume >= 0.50 THEN maintenance_failure_count END),
    'p95', MIN(CASE WHEN maintenance_cume >= 0.95 THEN maintenance_failure_count END),
    'p99', MIN(CASE WHEN maintenance_cume >= 0.99 THEN maintenance_failure_count END),
    'max', MAX(maintenance_failure_count)
  ) AS maintenance_failure,
  json_object(
    'nonzero', SUM(cleanup_failure_count > 0),
    'average', ROUND(AVG(cleanup_failure_count), 3),
    'p50', MIN(CASE WHEN cleanup_cume >= 0.50 THEN cleanup_failure_count END),
    'p95', MIN(CASE WHEN cleanup_cume >= 0.95 THEN cleanup_failure_count END),
    'p99', MIN(CASE WHEN cleanup_cume >= 0.99 THEN cleanup_failure_count END),
    'max', MAX(cleanup_failure_count)
  ) AS cleanup_failure,
  json_object(
    'nonzero', SUM(realtime_failure_count > 0),
    'average', ROUND(AVG(realtime_failure_count), 3),
    'p50', MIN(CASE WHEN realtime_cume >= 0.50 THEN realtime_failure_count END),
    'p95', MIN(CASE WHEN realtime_cume >= 0.95 THEN realtime_failure_count END),
    'p99', MIN(CASE WHEN realtime_cume >= 0.99 THEN realtime_failure_count END),
    'max', MAX(realtime_failure_count)
  ) AS realtime_unavailable,
  json_object(
    'nonzero', SUM(rate_limited_count > 0),
    'average', ROUND(AVG(rate_limited_count), 3),
    'p50', MIN(CASE WHEN rate_limited_cume >= 0.50 THEN rate_limited_count END),
    'p95', MIN(CASE WHEN rate_limited_cume >= 0.95 THEN rate_limited_count END),
    'p99', MIN(CASE WHEN rate_limited_cume >= 0.99 THEN rate_limited_count END),
    'max', MAX(rate_limited_count)
  ) AS rate_limited,
  json_object(
    'nonzero', SUM(forbidden_count > 0),
    'average', ROUND(AVG(forbidden_count), 3),
    'p50', MIN(CASE WHEN forbidden_cume >= 0.50 THEN forbidden_count END),
    'p95', MIN(CASE WHEN forbidden_cume >= 0.95 THEN forbidden_count END),
    'p99', MIN(CASE WHEN forbidden_cume >= 0.99 THEN forbidden_count END),
    'max', MAX(forbidden_count)
  ) AS forbidden,
  json_object(
    'nonzero', SUM(preview_failure_count > 0),
    'average', ROUND(AVG(preview_failure_count), 3),
    'p50', MIN(CASE WHEN preview_cume >= 0.50 THEN preview_failure_count END),
    'p95', MIN(CASE WHEN preview_cume >= 0.95 THEN preview_failure_count END),
    'p99', MIN(CASE WHEN preview_cume >= 0.99 THEN preview_failure_count END),
    'max', MAX(preview_failure_count)
  ) AS preview_upstream_failed,
  json_object(
    'nonzero', SUM(media_not_found_count > 0),
    'average', ROUND(AVG(media_not_found_count), 3),
    'p50', MIN(CASE WHEN media_not_found_cume >= 0.50 THEN media_not_found_count END),
    'p95', MIN(CASE WHEN media_not_found_cume >= 0.95 THEN media_not_found_count END),
    'p99', MIN(CASE WHEN media_not_found_cume >= 0.99 THEN media_not_found_count END),
    'max', MAX(media_not_found_count)
  ) AS media_not_found
FROM ranked;

SELECT
  substr(created_at, 1, 10) AS utc_day,
  event_type,
  COUNT(*) AS events
FROM operational_events
WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
GROUP BY utc_day, event_type
ORDER BY utc_day DESC, events DESC, event_type;

WITH normalized_events AS (
  SELECT
    CASE WHEN route LIKE 'GET /ws/%' THEN 'GET /ws/:channel' ELSE route END AS normalized_route,
    event_type,
    status_code,
    created_at
  FROM operational_events
  WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
)
SELECT
  normalized_route AS route,
  event_type,
  status_code,
  COUNT(*) AS events,
  MAX(created_at) AS latest
FROM normalized_events
GROUP BY normalized_route, event_type, status_code
ORDER BY events DESC, latest DESC
LIMIT 50;

SELECT
  COUNT(*) AS pending_cleanup_jobs,
  COALESCE(MAX(attempt_count), 0) AS maximum_attempts,
  MIN(created_at) AS oldest_created_at,
  MIN(next_attempt_at) AS next_attempt_at
FROM cleanup_jobs
WHERE completed_at IS NULL;

SELECT
  id,
  resource_type,
  resource_id,
  attempt_count,
  next_attempt_at,
  substr(last_error, 1, 300) AS last_error,
  created_at,
  updated_at
FROM cleanup_jobs
WHERE completed_at IS NULL
ORDER BY created_at ASC
LIMIT 20;
