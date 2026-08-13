SELECT
  'support_sessions' AS invariant,
  COUNT(*) AS duplicate_users,
  COALESCE(SUM(open_count - 1), 0) AS excess_records
FROM (
  SELECT COUNT(*) AS open_count
  FROM support_sessions
  WHERE status = 'open'
  GROUP BY user_id
  HAVING COUNT(*) > 1
)
UNION ALL
SELECT
  'support_threads' AS invariant,
  COUNT(*) AS duplicate_users,
  COALESCE(SUM(open_count - 1), 0) AS excess_records
FROM (
  SELECT COUNT(*) AS open_count
  FROM support_threads
  WHERE status = 'open'
  GROUP BY user_id
  HAVING COUNT(*) > 1
);

SELECT
  user_id,
  COUNT(*) AS open_sessions
FROM support_sessions
WHERE status = 'open'
GROUP BY user_id
HAVING COUNT(*) > 1
ORDER BY open_sessions DESC, user_id;

SELECT
  user_id,
  COUNT(*) AS open_threads
FROM support_threads
WHERE status = 'open'
GROUP BY user_id
HAVING COUNT(*) > 1
ORDER BY open_threads DESC, user_id;
