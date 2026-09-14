-- One-time overlay for an empty canary Chat shard after repository migrations
-- through 0069 have been applied. Never run this against the control database.
--
-- The guard intentionally fails before trigger changes if application rows
-- already exist or the expected projection schema is incomplete.
DROP TABLE IF EXISTS _canary_chat_shard_bootstrap_guard;

CREATE TABLE _canary_chat_shard_bootstrap_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  channel_rows INTEGER NOT NULL CHECK (channel_rows = 0),
  local_projection_rows INTEGER NOT NULL CHECK (local_projection_rows = 0),
  local_report_projection_rows INTEGER NOT NULL
    CHECK (local_report_projection_rows = 0),
  local_report_watermark_rows INTEGER NOT NULL
    CHECK (local_report_watermark_rows = 0),
  domain_event_rows INTEGER NOT NULL CHECK (domain_event_rows = 0),
  projection_trigger_count INTEGER NOT NULL CHECK (projection_trigger_count = 3),
  report_projection_trigger_count INTEGER NOT NULL
    CHECK (report_projection_trigger_count = 3),
  domain_event_index_count INTEGER NOT NULL CHECK (domain_event_index_count = 4),
  dm_reply_control_fk_count INTEGER NOT NULL CHECK (dm_reply_control_fk_count = 0),
  dm_reply_shard_fk_count INTEGER NOT NULL CHECK (dm_reply_shard_fk_count = 2),
  dm_notification_owner_control_fk_count INTEGER NOT NULL
    CHECK (dm_notification_owner_control_fk_count = 1),
  dm_notification_owner_shard_fk_count INTEGER NOT NULL
    CHECK (dm_notification_owner_shard_fk_count = 2),
  message_notification_owner_control_fk_count INTEGER NOT NULL
    CHECK (message_notification_owner_control_fk_count = 1),
  message_notification_owner_shard_fk_count INTEGER NOT NULL
    CHECK (message_notification_owner_shard_fk_count = 2)
);

INSERT INTO _canary_chat_shard_bootstrap_guard (
  id,
  channel_rows,
  local_projection_rows,
  local_report_projection_rows,
  local_report_watermark_rows,
  domain_event_rows,
  projection_trigger_count,
  report_projection_trigger_count,
  domain_event_index_count,
  dm_reply_control_fk_count,
  dm_reply_shard_fk_count,
  dm_notification_owner_control_fk_count,
  dm_notification_owner_shard_fk_count,
  message_notification_owner_control_fk_count,
  message_notification_owner_shard_fk_count
)
SELECT
  1,
  (SELECT COUNT(*) FROM channels),
  (SELECT COUNT(*) FROM channel_control_projections),
  (SELECT COUNT(*) FROM channel_report_control_projections),
  (SELECT COUNT(*) FROM channel_report_projection_watermarks),
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
    WHERE type = 'trigger'
      AND name IN (
        'channel_report_projection_insert',
        'channel_report_projection_update',
        'channel_report_projection_delete'
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
  ),
  (
    SELECT COUNT(*)
    FROM pragma_foreign_key_list('dm_replies')
    WHERE "table" = 'users'
  ),
  (
    SELECT COUNT(*)
    FROM pragma_foreign_key_list('dm_replies')
    WHERE "table" IN ('dm', 'channels')
  ),
  (
    SELECT COUNT(*)
    FROM pragma_foreign_key_list('dm_notification_owners')
    WHERE "table" = 'users'
  ),
  (
    SELECT COUNT(*)
    FROM pragma_foreign_key_list('dm_notification_owners')
    WHERE "table" IN ('dm', 'channels')
  ),
  (
    SELECT COUNT(*)
    FROM pragma_foreign_key_list('message_notification_owners')
    WHERE "table" = 'users'
  ),
  (
    SELECT COUNT(*)
    FROM pragma_foreign_key_list('message_notification_owners')
    WHERE "table" IN ('messages', 'channels')
  );

CREATE TABLE chat_shard_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  shard_role TEXT NOT NULL CHECK (shard_role = 'chat-canary'),
  bootstrap_version INTEGER NOT NULL CHECK (bootstrap_version = 11),
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
  11,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TABLE canary_channel_copy_jobs (
  channel_id TEXT PRIMARY KEY,
  source_projection_version INTEGER NOT NULL
    CHECK (source_projection_version > 0),
  stage TEXT NOT NULL DEFAULT 'prepared'
    CHECK (stage IN (
      'prepared',
      'channels_copied',
      'moderators_copied',
      'blocked_copied',
      'banned_words_copied',
      'channel_moderation_copied',
      'channel_petitions_copied',
      'config_copied',
      'upload_tickets_copied',
      'message_roots_copied',
      'messages_copied',
      'message_actors_copied',
      'message_links_rebuilt',
      'delta_roots_upserting',
      'delta_messages_upserting',
      'delta_pruning',
      'delta_messages_copied',
      'delta_message_actors_copied',
      'delta_links_rebuilt',
      'delta_dm_roots_upserting',
      'delta_dm_replies_upserting',
      'delta_dm_replies_pruning',
      'delta_dm_roots_pruning',
      'delta_dm_actors_copying',
      'delta_dm_notification_owners_copying',
      'delta_dm_dependents_copied',
      'delta_dm_verified',
      'delta_message_notification_owners_copying',
      'delta_message_notification_owners_pruning',
      'delta_message_notification_owners_copied',
      'delta_notification_manifest_verified',
      'delta_channel_reports_copying',
      'delta_channel_reports_pruning',
      'delta_channel_reports_copied',
      'delta_channel_reports_verified'
    )),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'failed', 'abandoned', 'complete')),
  cursor_channel_id TEXT,
  cursor_created_at TEXT,
  cursor_row_id TEXT,
  message_snapshot_created_at TEXT,
  message_snapshot_id TEXT,
  stage_rows_copied INTEGER NOT NULL DEFAULT 0
    CHECK (stage_rows_copied >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX canary_channel_copy_jobs_status_updated_idx
  ON canary_channel_copy_jobs(status, updated_at, channel_id);

CREATE TABLE canary_message_reconciliation_seen (
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (channel_id, message_id)
);

CREATE TABLE canary_dm_reconciliation_seen (
  channel_id TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('dm', 'dm_reply')),
  record_id TEXT NOT NULL,
  PRIMARY KEY (channel_id, record_type, record_id)
);

CREATE TABLE canary_notification_reconciliation_seen (
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (channel_id, message_id)
);

CREATE TABLE canary_channel_report_reconciliation_seen (
  channel_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  PRIMARY KEY (channel_id, report_id)
);

-- A Chat shard owns DM notification routing metadata, but account rows remain
-- in the control database. Preserve local DM/channel integrity without a
-- cross-database users foreign key.
CREATE TABLE dm_notification_owners_shard_boundary (
  dm_id TEXT PRIMARY KEY REFERENCES dm(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO dm_notification_owners_shard_boundary (
  dm_id, channel_id, user_id, created_at
)
SELECT dm_id, channel_id, user_id, created_at
FROM dm_notification_owners;

DROP TABLE dm_notification_owners;
ALTER TABLE dm_notification_owners_shard_boundary
  RENAME TO dm_notification_owners;

CREATE INDEX dm_notification_owners_user_idx
  ON dm_notification_owners(user_id, created_at DESC);

-- Reply notification routing is channel-local, while the referenced account
-- remains authoritative in control D1. Retain message/channel integrity only.
CREATE TABLE message_notification_owners_shard_boundary (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO message_notification_owners_shard_boundary (
  message_id, channel_id, user_id, created_at
)
SELECT message_id, channel_id, user_id, created_at
FROM message_notification_owners;

DROP TABLE message_notification_owners;
ALTER TABLE message_notification_owners_shard_boundary
  RENAME TO message_notification_owners;

CREATE INDEX message_notification_owners_user_idx
  ON message_notification_owners(user_id, created_at DESC);

CREATE TABLE canary_channel_cleanup_audit (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  source_projection_version INTEGER NOT NULL,
  previous_stage TEXT NOT NULL,
  previous_status TEXT NOT NULL
    CHECK (previous_status IN ('failed', 'abandoned')),
  cleaned_at TEXT NOT NULL
);

CREATE INDEX canary_channel_cleanup_audit_channel_idx
  ON canary_channel_cleanup_audit(channel_id, cleaned_at DESC, id DESC);

DROP TRIGGER channel_control_projection_insert;
DROP TRIGGER channel_control_projection_update;
DROP TRIGGER channel_control_projection_delete;
DROP TRIGGER channel_report_projection_insert;
DROP TRIGGER channel_report_projection_update;
DROP TRIGGER channel_report_projection_delete;

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

-- Reports remain canonical in the Chat shard. These triggers advance a local
-- ordering watermark and emit the complete control-projection event, but never
-- write the shard's empty channel_report_control_projections table.
CREATE TRIGGER channel_report_projection_insert
AFTER INSERT ON channel_reports
BEGIN
  INSERT INTO channel_report_projection_watermarks (
    report_id, channel_id, source_version, state, updated_at
  ) VALUES (
    NEW.id, NEW.channel_id, NEW.projection_source_version, 'active',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(report_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    source_version = excluded.source_version,
    state = excluded.state,
    updated_at = excluded.updated_at
  WHERE excluded.source_version > channel_report_projection_watermarks.source_version;

  INSERT INTO domain_events (
    id, channel_id, aggregate_type, aggregate_id, event_type, source_version,
    payload_json, status, attempt_count, next_attempt_at, created_at, updated_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.channel_id, 'channel_report', NEW.id,
    'channel_report_projection_upsert', NEW.projection_source_version,
    json_object(
      'channel_name', channel.name,
      'channel_owner_uid', channel.owner_uid,
      'reporter_uid', NEW.reporter_uid,
      'reporter_auth_uid', NEW.reporter_auth_uid,
      'reporter_device_id', NEW.reporter_device_id,
      'reason', NEW.reason,
      'details', NEW.details,
      'created_at', NEW.created_at,
      'status', NEW.status,
      'resolution_note', NEW.resolution_note,
      'resolved_at', NEW.resolved_at,
      'inbox_message_id', NEW.inbox_message_id,
      'state', 'active'
    ),
    'pending', 0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM channels AS channel
  WHERE channel.id = NEW.channel_id;
END;

CREATE TRIGGER channel_report_projection_update
AFTER UPDATE OF
  reporter_uid, reporter_auth_uid, reporter_device_id, reason, details,
  created_at, status, resolution_note, resolved_at, inbox_message_id
ON channel_reports
BEGIN
  UPDATE channel_reports
  SET projection_source_version = OLD.projection_source_version + 1
  WHERE id = NEW.id;

  INSERT INTO channel_report_projection_watermarks (
    report_id, channel_id, source_version, state, updated_at
  ) VALUES (
    NEW.id, NEW.channel_id, OLD.projection_source_version + 1, 'active',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(report_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    source_version = excluded.source_version,
    state = excluded.state,
    updated_at = excluded.updated_at
  WHERE excluded.source_version > channel_report_projection_watermarks.source_version;

  INSERT INTO domain_events (
    id, channel_id, aggregate_type, aggregate_id, event_type, source_version,
    payload_json, status, attempt_count, next_attempt_at, created_at, updated_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.channel_id, 'channel_report', NEW.id,
    'channel_report_projection_upsert', OLD.projection_source_version + 1,
    json_object(
      'channel_name', channel.name,
      'channel_owner_uid', channel.owner_uid,
      'reporter_uid', NEW.reporter_uid,
      'reporter_auth_uid', NEW.reporter_auth_uid,
      'reporter_device_id', NEW.reporter_device_id,
      'reason', NEW.reason,
      'details', NEW.details,
      'created_at', NEW.created_at,
      'status', NEW.status,
      'resolution_note', NEW.resolution_note,
      'resolved_at', NEW.resolved_at,
      'inbox_message_id', NEW.inbox_message_id,
      'state', 'active'
    ),
    'pending', 0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM channels AS channel
  WHERE channel.id = NEW.channel_id;
END;

CREATE TRIGGER channel_report_projection_delete
AFTER DELETE ON channel_reports
BEGIN
  INSERT INTO channel_report_projection_watermarks (
    report_id, channel_id, source_version, state, updated_at
  ) VALUES (
    OLD.id, OLD.channel_id, OLD.projection_source_version + 1, 'deleted',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(report_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    source_version = excluded.source_version,
    state = excluded.state,
    updated_at = excluded.updated_at
  WHERE excluded.source_version > channel_report_projection_watermarks.source_version;

  INSERT INTO domain_events (
    id, channel_id, aggregate_type, aggregate_id, event_type, source_version,
    payload_json, status, attempt_count, next_attempt_at, created_at, updated_at
  ) VALUES (
    lower(hex(randomblob(16))), OLD.channel_id, 'channel_report', OLD.id,
    'channel_report_projection_delete', OLD.projection_source_version + 1,
    json_object('state', 'deleted'),
    'pending', 0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;

DROP TABLE _canary_chat_shard_bootstrap_guard;
