-- Shard-local durable event ledger. Source mutations and event inserts happen
-- in one SQLite transaction through triggers. Consumers are added separately.
CREATE TABLE domain_events (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  payload_json TEXT NOT NULL
    CHECK (json_valid(payload_json) AND length(payload_json) <= 16384),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(channel_id, event_type, aggregate_id, source_version)
);

CREATE INDEX domain_events_attempt_ready_idx
  ON domain_events(status, next_attempt_at, created_at, id);

CREATE INDEX domain_events_lease_ready_idx
  ON domain_events(status, lease_until, created_at, id);

ALTER TABLE channels
  ADD COLUMN projection_source_version INTEGER NOT NULL DEFAULT 1
  CHECK (projection_source_version > 0);

ALTER TABLE channel_control_projections
  ADD COLUMN source_version INTEGER NOT NULL DEFAULT 1
  CHECK (source_version > 0);

DROP TRIGGER channel_control_projection_insert;
DROP TRIGGER channel_control_projection_update;
DROP TRIGGER channel_control_projection_delete;

CREATE TRIGGER channel_control_projection_insert
AFTER INSERT ON channels
WHEN NEW.id NOT LIKE '%_live'
BEGIN
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
    NEW.projection_source_version
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
    NEW.projection_source_version,
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
  UPDATE channels
  SET projection_source_version = OLD.projection_source_version + 1
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
    OLD.projection_source_version + 1
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
    OLD.projection_source_version + 1,
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
    OLD.projection_source_version + 1,
    json_object('state', 'deleted'),
    'pending',
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;
