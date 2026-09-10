-- Preserve projection ordering across channel deletion and recreation. The
-- same table acts as the source version ledger on Chat shards and as the
-- applied-event watermark in the control database.
CREATE TABLE channel_projection_versions (
  channel_id TEXT PRIMARY KEY,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  state TEXT NOT NULL CHECK (state IN ('active', 'deleted')),
  updated_at TEXT NOT NULL
);

INSERT INTO channel_projection_versions (
  channel_id,
  source_version,
  state,
  updated_at
)
SELECT
  id,
  projection_source_version,
  'active',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM channels
WHERE id NOT LIKE '%_live';

DROP TRIGGER channel_control_projection_insert;
DROP TRIGGER channel_control_projection_update;
DROP TRIGGER channel_control_projection_delete;

CREATE TRIGGER channel_control_projection_insert
AFTER INSERT ON channels
WHEN NEW.id NOT LIKE '%_live'
BEGIN
  INSERT INTO channel_projection_versions (
    channel_id,
    source_version,
    state,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.projection_source_version,
    'active',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(channel_id) DO UPDATE SET
    source_version = channel_projection_versions.source_version + 1,
    state = 'active',
    updated_at = excluded.updated_at;

  UPDATE channels
  SET projection_source_version = (
    SELECT source_version
    FROM channel_projection_versions
    WHERE channel_id = NEW.id
  )
  WHERE id = NEW.id;

  INSERT INTO channel_control_projections (
    channel_id,
    owner_uid,
    show_on_profile,
    created_at,
    projection_version,
    projected_at,
    source_version
  ) VALUES (
    NEW.id,
    NEW.owner_uid,
    COALESCE(NEW.show_on_profile, 0),
    NEW.created_at,
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    (SELECT source_version FROM channel_projection_versions WHERE channel_id = NEW.id)
  )
  ON CONFLICT(channel_id) DO UPDATE SET
    owner_uid = excluded.owner_uid,
    show_on_profile = excluded.show_on_profile,
    created_at = excluded.created_at,
    projection_version = channel_control_projections.projection_version + 1,
    projected_at = excluded.projected_at,
    source_version = excluded.source_version
  WHERE excluded.source_version > channel_control_projections.source_version;

  INSERT INTO domain_events (
    id,
    channel_id,
    aggregate_type,
    aggregate_id,
    event_type,
    source_version,
    payload_json,
    status,
    attempt_count,
    next_attempt_at,
    created_at,
    updated_at
  ) VALUES (
    lower(hex(randomblob(16))),
    NEW.id,
    'channel',
    NEW.id,
    'channel_projection_upsert',
    (SELECT source_version FROM channel_projection_versions WHERE channel_id = NEW.id),
    json_object(
      'owner_uid', NEW.owner_uid,
      'show_on_profile', COALESCE(NEW.show_on_profile, 0),
      'created_at', NEW.created_at,
      'state', 'active'
    ),
    'pending',
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;

CREATE TRIGGER channel_control_projection_update
AFTER UPDATE OF owner_uid, show_on_profile, created_at ON channels
WHEN NEW.id NOT LIKE '%_live'
BEGIN
  UPDATE channel_projection_versions
  SET source_version = source_version + 1,
      state = 'active',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE channel_id = NEW.id;

  UPDATE channels
  SET projection_source_version = (
    SELECT source_version
    FROM channel_projection_versions
    WHERE channel_id = NEW.id
  )
  WHERE id = NEW.id;

  INSERT INTO channel_control_projections (
    channel_id,
    owner_uid,
    show_on_profile,
    created_at,
    projection_version,
    projected_at,
    source_version
  ) VALUES (
    NEW.id,
    NEW.owner_uid,
    COALESCE(NEW.show_on_profile, 0),
    NEW.created_at,
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    (SELECT source_version FROM channel_projection_versions WHERE channel_id = NEW.id)
  )
  ON CONFLICT(channel_id) DO UPDATE SET
    owner_uid = excluded.owner_uid,
    show_on_profile = excluded.show_on_profile,
    created_at = excluded.created_at,
    projection_version = channel_control_projections.projection_version + 1,
    projected_at = excluded.projected_at,
    source_version = excluded.source_version
  WHERE excluded.source_version > channel_control_projections.source_version;

  INSERT INTO domain_events (
    id,
    channel_id,
    aggregate_type,
    aggregate_id,
    event_type,
    source_version,
    payload_json,
    status,
    attempt_count,
    next_attempt_at,
    created_at,
    updated_at
  ) VALUES (
    lower(hex(randomblob(16))),
    NEW.id,
    'channel',
    NEW.id,
    'channel_projection_upsert',
    (SELECT source_version FROM channel_projection_versions WHERE channel_id = NEW.id),
    json_object(
      'owner_uid', NEW.owner_uid,
      'show_on_profile', COALESCE(NEW.show_on_profile, 0),
      'created_at', NEW.created_at,
      'state', 'active'
    ),
    'pending',
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;

CREATE TRIGGER channel_control_projection_delete
AFTER DELETE ON channels
WHEN OLD.id NOT LIKE '%_live'
BEGIN
  UPDATE channel_projection_versions
  SET source_version = source_version + 1,
      state = 'deleted',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE channel_id = OLD.id;

  DELETE FROM channel_control_projections
  WHERE channel_id = OLD.id;

  INSERT INTO domain_events (
    id,
    channel_id,
    aggregate_type,
    aggregate_id,
    event_type,
    source_version,
    payload_json,
    status,
    attempt_count,
    next_attempt_at,
    created_at,
    updated_at
  ) VALUES (
    lower(hex(randomblob(16))),
    OLD.id,
    'channel',
    OLD.id,
    'channel_projection_delete',
    (SELECT source_version FROM channel_projection_versions WHERE channel_id = OLD.id),
    json_object('state', 'deleted'),
    'pending',
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;
