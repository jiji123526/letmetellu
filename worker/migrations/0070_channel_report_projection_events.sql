-- Keep monolith report projections transactionally current while also
-- emitting the durable events required by a future Chat-shard split.
CREATE TRIGGER channel_report_projection_insert
AFTER INSERT ON channel_reports
BEGIN
  INSERT INTO channel_report_projection_watermarks (
    report_id, channel_id, source_version, state, updated_at
  ) VALUES (
    NEW.id,
    NEW.channel_id,
    NEW.projection_source_version,
    'active',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(report_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    source_version = excluded.source_version,
    state = excluded.state,
    updated_at = excluded.updated_at
  WHERE excluded.source_version > channel_report_projection_watermarks.source_version;

  INSERT INTO channel_report_control_projections (
    report_id, channel_id, channel_name, channel_owner_uid,
    reporter_uid, reporter_auth_uid, reporter_device_id, reason, details,
    created_at, status, resolution_note, resolved_at, inbox_message_id,
    source_version, projected_at
  )
  SELECT
    NEW.id, NEW.channel_id, channel.name, channel.owner_uid,
    NEW.reporter_uid, NEW.reporter_auth_uid, NEW.reporter_device_id,
    NEW.reason, NEW.details, NEW.created_at, NEW.status,
    NEW.resolution_note, NEW.resolved_at, NEW.inbox_message_id,
    NEW.projection_source_version,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM channels AS channel
  WHERE channel.id = NEW.channel_id
  ON CONFLICT(report_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    channel_name = excluded.channel_name,
    channel_owner_uid = excluded.channel_owner_uid,
    reporter_uid = excluded.reporter_uid,
    reporter_auth_uid = excluded.reporter_auth_uid,
    reporter_device_id = excluded.reporter_device_id,
    reason = excluded.reason,
    details = excluded.details,
    created_at = excluded.created_at,
    status = excluded.status,
    resolution_note = excluded.resolution_note,
    resolved_at = excluded.resolved_at,
    inbox_message_id = excluded.inbox_message_id,
    source_version = excluded.source_version,
    projected_at = excluded.projected_at
  WHERE excluded.source_version > channel_report_control_projections.source_version;

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
  reporter_uid,
  reporter_auth_uid,
  reporter_device_id,
  reason,
  details,
  created_at,
  status,
  resolution_note,
  resolved_at,
  inbox_message_id
ON channel_reports
BEGIN
  UPDATE channel_reports
  SET projection_source_version = OLD.projection_source_version + 1
  WHERE id = NEW.id;

  INSERT INTO channel_report_projection_watermarks (
    report_id, channel_id, source_version, state, updated_at
  ) VALUES (
    NEW.id,
    NEW.channel_id,
    OLD.projection_source_version + 1,
    'active',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(report_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    source_version = excluded.source_version,
    state = excluded.state,
    updated_at = excluded.updated_at
  WHERE excluded.source_version > channel_report_projection_watermarks.source_version;

  INSERT INTO channel_report_control_projections (
    report_id, channel_id, channel_name, channel_owner_uid,
    reporter_uid, reporter_auth_uid, reporter_device_id, reason, details,
    created_at, status, resolution_note, resolved_at, inbox_message_id,
    source_version, projected_at
  )
  SELECT
    NEW.id, NEW.channel_id, channel.name, channel.owner_uid,
    NEW.reporter_uid, NEW.reporter_auth_uid, NEW.reporter_device_id,
    NEW.reason, NEW.details, NEW.created_at, NEW.status,
    NEW.resolution_note, NEW.resolved_at, NEW.inbox_message_id,
    OLD.projection_source_version + 1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM channels AS channel
  WHERE channel.id = NEW.channel_id
  ON CONFLICT(report_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    channel_name = excluded.channel_name,
    channel_owner_uid = excluded.channel_owner_uid,
    reporter_uid = excluded.reporter_uid,
    reporter_auth_uid = excluded.reporter_auth_uid,
    reporter_device_id = excluded.reporter_device_id,
    reason = excluded.reason,
    details = excluded.details,
    created_at = excluded.created_at,
    status = excluded.status,
    resolution_note = excluded.resolution_note,
    resolved_at = excluded.resolved_at,
    inbox_message_id = excluded.inbox_message_id,
    source_version = excluded.source_version,
    projected_at = excluded.projected_at
  WHERE excluded.source_version > channel_report_control_projections.source_version;

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
    OLD.id,
    OLD.channel_id,
    OLD.projection_source_version + 1,
    'deleted',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(report_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    source_version = excluded.source_version,
    state = excluded.state,
    updated_at = excluded.updated_at
  WHERE excluded.source_version > channel_report_projection_watermarks.source_version;

  DELETE FROM channel_report_control_projections
  WHERE report_id = OLD.id
    AND source_version <= OLD.projection_source_version + 1;

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
