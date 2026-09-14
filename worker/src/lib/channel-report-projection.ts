const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;
const REPORT_REASONS = new Set([
  "spam",
  "harassment",
  "sexual_content",
  "privacy",
  "impersonation",
  "illegal_content",
  "other",
]);
const REPORT_STATUSES = new Set(["open", "resolved", "dismissed"]);

export interface ChannelReportProjectionEventRow {
  id: string;
  channel_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  source_version: number;
  payload_json: string;
}

interface ReportProjectionFields {
  channelName: string;
  channelOwnerUid: string;
  reporterUid: string;
  reporterAuthUid: string | null;
  reporterDeviceId: string | null;
  reason: string;
  details: string | null;
  createdAt: string;
  status: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  inboxMessageId: string | null;
}

export type ChannelReportProjectionEvent =
  | ({
      id: string;
      reportId: string;
      channelId: string;
      sourceVersion: number;
      type: "upsert";
    } & ReportProjectionFields)
  | {
      id: string;
      reportId: string;
      channelId: string;
      sourceVersion: number;
      type: "delete";
    };

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isNullableBoundedString(
  value: unknown,
  maxLength: number,
): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function isIsoDate(value: unknown, nullable = false): value is string | null {
  return (nullable && value === null)
    || (
      typeof value === "string"
      && value.length > 0
      && value.length <= 40
      && Number.isFinite(Date.parse(value))
    );
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

export function parseChannelReportProjectionEvent(
  row: ChannelReportProjectionEventRow,
): ChannelReportProjectionEvent | null {
  if (
    !isBoundedString(row.id, 64)
    || !CHANNEL_ID_PATTERN.test(row.channel_id)
    || row.aggregate_type !== "channel_report"
    || !isBoundedString(row.aggregate_id, 64)
    || !Number.isSafeInteger(row.source_version)
    || row.source_version <= 0
    || typeof row.payload_json !== "string"
    || row.payload_json.length > 16_384
  ) return null;

  let payload: Record<string, unknown>;
  try {
    const decoded = JSON.parse(row.payload_json);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
    payload = decoded as Record<string, unknown>;
  } catch {
    return null;
  }

  if (row.event_type === "channel_report_projection_delete") {
    if (payload.state !== "deleted" || !hasOnlyKeys(payload, ["state"])) return null;
    return {
      id: row.id,
      reportId: row.aggregate_id,
      channelId: row.channel_id,
      sourceVersion: row.source_version,
      type: "delete",
    };
  }

  if (
    row.event_type !== "channel_report_projection_upsert"
    || payload.state !== "active"
    || !hasOnlyKeys(payload, [
      "channel_name",
      "channel_owner_uid",
      "reporter_uid",
      "reporter_auth_uid",
      "reporter_device_id",
      "reason",
      "details",
      "created_at",
      "status",
      "resolution_note",
      "resolved_at",
      "inbox_message_id",
      "state",
    ])
    || !isBoundedString(payload.channel_name, 120)
    || !isBoundedString(payload.channel_owner_uid, 128)
    || !isBoundedString(payload.reporter_uid, 128)
    || !isNullableBoundedString(payload.reporter_auth_uid, 128)
    || !isNullableBoundedString(payload.reporter_device_id, 256)
    || typeof payload.reason !== "string"
    || !REPORT_REASONS.has(payload.reason)
    || !isNullableBoundedString(payload.details, 500)
    || !isIsoDate(payload.created_at)
    || typeof payload.status !== "string"
    || !REPORT_STATUSES.has(payload.status)
    || !isNullableBoundedString(payload.resolution_note, 2_000)
    || !isIsoDate(payload.resolved_at, true)
    || !isNullableBoundedString(payload.inbox_message_id, 64)
  ) return null;

  return {
    id: row.id,
    reportId: row.aggregate_id,
    channelId: row.channel_id,
    sourceVersion: row.source_version,
    type: "upsert",
    channelName: payload.channel_name,
    channelOwnerUid: payload.channel_owner_uid,
    reporterUid: payload.reporter_uid,
    reporterAuthUid: payload.reporter_auth_uid,
    reporterDeviceId: payload.reporter_device_id,
    reason: payload.reason,
    details: payload.details,
    createdAt: payload.created_at as string,
    status: payload.status,
    resolutionNote: payload.resolution_note,
    resolvedAt: payload.resolved_at,
    inboxMessageId: payload.inbox_message_id,
  };
}

export async function applyChannelReportProjectionEvent(
  controlDatabase: D1Database,
  event: ChannelReportProjectionEvent,
  now: string,
): Promise<void> {
  const watermark = controlDatabase.prepare(`
    INSERT INTO channel_report_projection_watermarks (
      report_id, channel_id, source_version, state, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(report_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      source_version = excluded.source_version,
      state = excluded.state,
      updated_at = excluded.updated_at
    WHERE excluded.source_version > channel_report_projection_watermarks.source_version
  `).bind(
    event.reportId,
    event.channelId,
    event.sourceVersion,
    event.type === "upsert" ? "active" : "deleted",
    now,
  );

  if (event.type === "delete") {
    await controlDatabase.batch([
      watermark,
      controlDatabase.prepare(`
        DELETE FROM channel_report_control_projections
        WHERE report_id = ?
          AND source_version <= ?
          AND EXISTS (
            SELECT 1 FROM channel_report_projection_watermarks
            WHERE report_id = ? AND source_version = ? AND state = 'deleted'
          )
      `).bind(event.reportId, event.sourceVersion, event.reportId, event.sourceVersion),
    ]);
    return;
  }

  await controlDatabase.batch([
    watermark,
    controlDatabase.prepare(`
      INSERT INTO channel_report_control_projections (
        report_id, channel_id, channel_name, channel_owner_uid,
        reporter_uid, reporter_auth_uid,
        reporter_device_id, reason, details, created_at, status,
        resolution_note, resolved_at, inbox_message_id, source_version,
        projected_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM channel_report_projection_watermarks
        WHERE report_id = ? AND source_version = ? AND state = 'active'
      )
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
      WHERE excluded.source_version > channel_report_control_projections.source_version
    `).bind(
      event.reportId,
      event.channelId,
      event.channelName,
      event.channelOwnerUid,
      event.reporterUid,
      event.reporterAuthUid,
      event.reporterDeviceId,
      event.reason,
      event.details,
      event.createdAt,
      event.status,
      event.resolutionNote,
      event.resolvedAt,
      event.inboxMessageId,
      event.sourceVersion,
      now,
      event.reportId,
      event.sourceVersion,
    ),
  ]);
}
