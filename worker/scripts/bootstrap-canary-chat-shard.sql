-- One-time overlay for an empty canary Chat shard after repository migrations
-- through 0067 have been applied. Never run this against the control database.
--
-- The guard intentionally fails before trigger changes if application rows
-- already exist or the expected projection schema is incomplete.
DROP TABLE IF EXISTS _canary_chat_shard_bootstrap_guard;

CREATE TABLE _canary_chat_shard_bootstrap_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  channel_rows INTEGER NOT NULL CHECK (channel_rows = 0),
  local_projection_rows INTEGER NOT NULL CHECK (local_projection_rows = 0),
  domain_event_rows INTEGER NOT NULL CHECK (domain_event_rows = 0),
  projection_trigger_count INTEGER NOT NULL CHECK (projection_trigger_count = 3),
  domain_event_index_count INTEGER NOT NULL CHECK (domain_event_index_count = 4)
);

INSERT INTO _canary_chat_shard_bootstrap_guard (
  id,
  channel_rows,
  local_projection_rows,
  domain_event_rows,
  projection_trigger_count,
  domain_event_index_count
)
SELECT
  1,
  (SELECT COUNT(*) FROM channels),
  (SELECT COUNT(*) FROM channel_control_projections),
  (SELECT COUNT(*) FROM domain_events),
  (
    SELECT COUNT(*)
    FROM sqlite_schema
    WHERE type = 'trigger'
      AND name IN (
        'channel_control_projection_insert',
        'channel_control_projection_update',
        'channel_control_projection_delete'
      )
  ),
  (
    SELECT COUNT(*)
    FROM sqlite_schema
    WHERE type = 'index'
      AND name IN (
        'domain_events_attempt_ready_idx',
        'domain_events_lease_ready_idx',
        'domain_events_delivered_updated_idx',
        'domain_events_dead_updated_idx'
      )
  );

CREATE TABLE chat_shard_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  shard_role TEXT NOT NULL CHECK (shard_role = 'chat-canary'),
  bootstrap_version INTEGER NOT NULL CHECK (bootstrap_version = 1),
  bootstrapped_at TEXT NOT NULL
);

INSERT INTO chat_shard_metadata (
  id,
  shard_role,
  bootstrap_version,
  bootstrapped_at
) VALUES (
  1,
  'chat-canary',
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

DROP TRIGGER channel_control_projection_insert;
DROP TRIGGER channel_control_projection_update;
DROP TRIGGER channel_control_projection_delete;

-- Chat shards own canonical channel rows and emit durable projection events.
-- They never write the control-plane projection table directly.
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

DROP TABLE _canary_chat_shard_bootstrap_guard;
