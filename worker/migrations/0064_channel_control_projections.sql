-- Non-authoritative account-wide channel metadata used by control-plane reads.
-- Passcodes, moderation, and other authorization state must remain shard-local.
CREATE TABLE channel_control_projections (
  channel_id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  show_on_profile INTEGER NOT NULL DEFAULT 0
    CHECK (show_on_profile IN (0, 1)),
  created_at TEXT,
  projection_version INTEGER NOT NULL DEFAULT 1
    CHECK (projection_version > 0),
  projected_at TEXT NOT NULL
);

INSERT INTO channel_control_projections (
  channel_id,
  owner_uid,
  show_on_profile,
  created_at,
  projection_version,
  projected_at
)
SELECT
  id,
  owner_uid,
  COALESCE(show_on_profile, 0),
  created_at,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM channels
WHERE id NOT LIKE '%_live';

CREATE INDEX channel_control_projections_owner_profile_idx
  ON channel_control_projections(
    owner_uid,
    show_on_profile,
    created_at,
    channel_id
  );

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
    projected_at
  ) VALUES (
    NEW.id,
    NEW.owner_uid,
    COALESCE(NEW.show_on_profile, 0),
    NEW.created_at,
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(channel_id) DO UPDATE SET
    owner_uid = excluded.owner_uid,
    show_on_profile = excluded.show_on_profile,
    created_at = excluded.created_at,
    projection_version = channel_control_projections.projection_version + 1,
    projected_at = excluded.projected_at;
END;

CREATE TRIGGER channel_control_projection_update
AFTER UPDATE OF owner_uid, show_on_profile, created_at ON channels
WHEN NEW.id NOT LIKE '%_live'
BEGIN
  INSERT INTO channel_control_projections (
    channel_id,
    owner_uid,
    show_on_profile,
    created_at,
    projection_version,
    projected_at
  ) VALUES (
    NEW.id,
    NEW.owner_uid,
    COALESCE(NEW.show_on_profile, 0),
    NEW.created_at,
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(channel_id) DO UPDATE SET
    owner_uid = excluded.owner_uid,
    show_on_profile = excluded.show_on_profile,
    created_at = excluded.created_at,
    projection_version = channel_control_projections.projection_version + 1,
    projected_at = excluded.projected_at;
END;

CREATE TRIGGER channel_control_projection_delete
AFTER DELETE ON channels
BEGIN
  DELETE FROM channel_control_projections
  WHERE channel_id = OLD.id;
END;
