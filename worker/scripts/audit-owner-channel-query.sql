PRAGMA index_info('channels_owner_profile_created_id_idx');

EXPLAIN QUERY PLAN
SELECT id
FROM channels
WHERE owner_uid = '__owner_audit__'
  AND show_on_profile = 1
  AND id NOT LIKE '%_live'
  AND id != 'reports'
LIMIT 2;

EXPLAIN QUERY PLAN
SELECT id, name, profile_image, bubble_color,
       passcode IS NOT NULL AS has_passcode
FROM channels
WHERE owner_uid = '__owner_audit__'
  AND id NOT LIKE '%_live'
  AND id != 'reports'
  AND show_on_profile = 1
ORDER BY created_at ASC, id ASC
LIMIT 5;
