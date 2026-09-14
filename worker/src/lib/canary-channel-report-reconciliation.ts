import type { Env } from "../types.ts";
import {
  type CanaryChannelCopyResult,
  type CopyStage,
} from "./canary-channel-copy.ts";
import {
  type CanaryShardId,
  resolveCanaryProjectionSource,
} from "./channel-projection-dispatcher.ts";

const REPORT_BATCH_SIZE = 40;

interface JobRow {
  source_projection_version: number;
  stage: CopyStage;
  status: "active" | "failed" | "abandoned" | "complete";
  cursor_created_at: string | null;
  cursor_row_id: string | null;
  stage_rows_copied: number;
}

interface ReportRow extends Record<string, unknown> {
  id: string;
  channel_id: string;
  reporter_uid: string;
  reporter_auth_uid: string | null;
  reporter_device_id: string | null;
  reason: string;
  details: string | null;
  created_at: string;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  inbox_message_id: string | null;
  projection_source_version: number;
}

interface ReportIntegrityRow {
  report_count: number;
  version_sum: number;
  watermark_mismatch_count: number;
  projection_mismatch_count: number;
  event_mismatch_count: number;
  local_projection_count: number;
}

const REPORT_COLUMNS = [
  "id",
  "channel_id",
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
  "projection_source_version",
] as const;

async function readJob(destination: D1Database, channelId: string) {
  return destination.prepare(`
    SELECT source_projection_version, stage, status,
      cursor_created_at, cursor_row_id, stage_rows_copied
    FROM canary_channel_copy_jobs
    WHERE channel_id = ?
  `).bind(channelId).first<JobRow>();
}

function response(input: {
  shardId: CanaryShardId;
  channelId: string;
  stage: CopyStage;
  status: "active" | "failed" | "abandoned" | "complete";
  idempotent: boolean;
  blockers?: string[];
  batchRowsCopied?: number;
  stageRowsCopied?: number;
  hasMore?: boolean;
}): CanaryChannelCopyResult {
  return {
    shardId: input.shardId,
    channelId: input.channelId,
    stage: input.stage,
    status: input.status,
    idempotent: input.idempotent,
    blockers: input.blockers || [],
    ...(input.batchRowsCopied === undefined ? {} : { batchRowsCopied: input.batchRowsCopied }),
    ...(input.stageRowsCopied === undefined ? {} : { stageRowsCopied: input.stageRowsCopied }),
    ...(input.hasMore === undefined ? {} : { hasMore: input.hasMore }),
  };
}

async function sourceBlocker(input: {
  source: D1Database;
  channelId: string;
  expectedVersion: number;
}) {
  const row = await input.source.prepare(`
    SELECT
      channel.projection_source_version,
      EXISTS (
        SELECT 1 FROM pending_admin_deletions
        WHERE channel_id IN (?, ?) LIMIT 1
      ) AS active_undo_rows
    FROM channels AS channel
    WHERE channel.id = ?
  `).bind(
    input.channelId,
    `${input.channelId}_live`,
    input.channelId,
  ).first<{ projection_source_version: number; active_undo_rows: number }>();
  if (!row || Number(row.projection_source_version) !== input.expectedVersion) {
    return "source_version_changed";
  }
  return Number(row.active_undo_rows) > 0 ? "source_undo_active" : null;
}

async function markFailed(destination: D1Database, channelId: string) {
  await destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET status = 'failed', updated_at = ?
    WHERE channel_id = ? AND status = 'active'
  `).bind(new Date().toISOString(), channelId).run();
}

function rowsMatch(left: ReportRow, right: ReportRow) {
  return REPORT_COLUMNS.every((column) => {
    if (column === "projection_source_version") {
      return Number(left[column]) === Number(right[column]);
    }
    return left[column] === right[column];
  });
}

async function copyReportBatch(input: {
  source: D1Database;
  destination: D1Database;
  channelId: string;
  job: JobRow;
}) {
  const cursorCreatedAt = input.job.cursor_created_at || "";
  const cursorId = input.job.cursor_row_id || "";
  const rows = await input.source.prepare(`
    SELECT ${REPORT_COLUMNS.join(", ")}
    FROM channel_reports
    WHERE channel_id IN (?, ?)
      AND (
        ? = '' OR created_at > ? OR (created_at = ? AND id > ?)
      )
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).bind(
    input.channelId,
    `${input.channelId}_live`,
    cursorCreatedAt,
    cursorCreatedAt,
    cursorCreatedAt,
    cursorId,
    REPORT_BATCH_SIZE + 1,
  ).all<ReportRow>();
  const batch = rows.results.slice(0, REPORT_BATCH_SIZE);
  const hasMore = rows.results.length > REPORT_BATCH_SIZE;
  const last = batch.at(-1);

  if (batch.length > 0) {
    const placeholders = batch.map(() => "?").join(", ");
    const existing = await input.destination.prepare(`
      SELECT ${REPORT_COLUMNS.join(", ")}
      FROM channel_reports
      WHERE id IN (${placeholders})
    `).bind(...batch.map((row) => row.id)).all<ReportRow>();
    const existingById = new Map(existing.results.map((row) => [row.id, row]));
    if (batch.some((row) => {
      const current = existingById.get(row.id);
      return current ? !rowsMatch(row, current) : false;
    })) {
      return { blocker: "channel_report_destination_conflict" } as const;
    }
  }

  const nextStage: CopyStage = hasMore
    ? "delta_channel_reports_copying"
    : "delta_channel_reports_pruning";
  const statements = batch.flatMap((row) => [
    input.destination.prepare(`
      INSERT OR IGNORE INTO channel_reports (
        ${REPORT_COLUMNS.join(", ")}
      ) VALUES (${REPORT_COLUMNS.map(() => "?").join(", ")})
    `).bind(...REPORT_COLUMNS.map((column) => row[column])),
    input.destination.prepare(`
      INSERT OR IGNORE INTO canary_channel_report_reconciliation_seen (
        channel_id, report_id
      ) VALUES (?, ?)
    `).bind(input.channelId, row.id),
  ]);
  statements.push(input.destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET stage = ?, cursor_created_at = ?, cursor_row_id = ?,
      stage_rows_copied = ?, updated_at = ?
    WHERE channel_id = ? AND source_projection_version = ?
      AND stage = 'delta_channel_reports_copying' AND status = 'active'
      AND COALESCE(cursor_created_at, '') = ?
      AND COALESCE(cursor_row_id, '') = ?
  `).bind(
    nextStage,
    hasMore ? last?.created_at || null : null,
    hasMore ? last?.id || null : null,
    hasMore ? Number(input.job.stage_rows_copied) + batch.length : 0,
    new Date().toISOString(),
    input.channelId,
    input.job.source_projection_version,
    cursorCreatedAt,
    cursorId,
  ));
  const results = await input.destination.batch(statements);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    throw new Error("canary_channel_report_job_advanced");
  }
  return { nextStage, batchRows: batch.length, hasMore } as const;
}

async function pruneReportBatch(input: {
  destination: D1Database;
  channelId: string;
  job: JobRow;
}) {
  const stale = await input.destination.prepare(`
    SELECT report.id
    FROM channel_reports AS report
    LEFT JOIN canary_channel_report_reconciliation_seen AS seen
      ON seen.channel_id = ? AND seen.report_id = report.id
    WHERE report.channel_id IN (?, ?) AND seen.report_id IS NULL
    ORDER BY report.created_at ASC, report.id ASC
    LIMIT ?
  `).bind(
    input.channelId,
    input.channelId,
    `${input.channelId}_live`,
    REPORT_BATCH_SIZE,
  ).all<{ id: string }>();
  const hasMore = stale.results.length === REPORT_BATCH_SIZE;
  const nextStage: CopyStage = hasMore
    ? "delta_channel_reports_pruning"
    : "delta_channel_reports_copied";
  const statements = stale.results.map((row) => input.destination.prepare(`
    DELETE FROM channel_reports WHERE id = ? AND channel_id IN (?, ?)
  `).bind(row.id, input.channelId, `${input.channelId}_live`));
  statements.push(input.destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET stage = ?, stage_rows_copied = ?, updated_at = ?
    WHERE channel_id = ? AND source_projection_version = ?
      AND stage = 'delta_channel_reports_pruning' AND status = 'active'
  `).bind(
    nextStage,
    hasMore ? Number(input.job.stage_rows_copied) + stale.results.length : 0,
    new Date().toISOString(),
    input.channelId,
    input.job.source_projection_version,
  ));
  const results = await input.destination.batch(statements);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    throw new Error("canary_channel_report_prune_job_advanced");
  }
  return { nextStage, batchRows: stale.results.length, hasMore };
}

export async function reconcileCanaryChannelReportsBatch(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const destination = resolveCanaryProjectionSource(input.env, input.shardId).database;
  let job = await readJob(destination, input.channelId);
  if (!job) throw new Error("canary_channel_report_job_missing");
  if (job.status === "active" && job.stage === "delta_notification_manifest_verified") {
    const update = await destination.prepare(`
      UPDATE canary_channel_copy_jobs
      SET stage = 'delta_channel_reports_copying', cursor_created_at = NULL,
        cursor_row_id = NULL, stage_rows_copied = 0, updated_at = ?
      WHERE channel_id = ? AND source_projection_version = ?
        AND stage = 'delta_notification_manifest_verified' AND status = 'active'
    `).bind(new Date().toISOString(), input.channelId, job.source_projection_version).run();
    if (Number(update.meta.changes || 0) !== 1) {
      throw new Error("canary_channel_report_job_not_started");
    }
    job = { ...job, stage: "delta_channel_reports_copying" };
  }
  if (
    job.status === "active"
    && (job.stage === "delta_channel_reports_copied" || job.stage === "delta_channel_reports_verified")
  ) {
    return response({ ...input, ...job, idempotent: true });
  }
  if (
    job.status !== "active"
    || (job.stage !== "delta_channel_reports_copying" && job.stage !== "delta_channel_reports_pruning")
  ) {
    return response({ ...input, ...job, idempotent: false, blockers: ["channel_report_reconciliation_not_ready"] });
  }
  const blocker = await sourceBlocker({
    source: input.env.DB,
    channelId: input.channelId,
    expectedVersion: job.source_projection_version,
  });
  if (blocker) {
    await markFailed(destination, input.channelId);
    return response({ ...input, ...job, status: "failed", idempotent: false, blockers: [blocker] });
  }
  const result = job.stage === "delta_channel_reports_copying"
    ? await copyReportBatch({ source: input.env.DB, destination, channelId: input.channelId, job })
    : await pruneReportBatch({ destination, channelId: input.channelId, job });
  if ("blocker" in result && result.blocker) {
    await markFailed(destination, input.channelId);
    return response({
      ...input,
      stage: job.stage,
      status: "failed",
      idempotent: false,
      blockers: [result.blocker],
    });
  }
  return response({
    ...input,
    stage: result.nextStage,
    status: "active",
    idempotent: false,
    batchRowsCopied: result.batchRows,
    stageRowsCopied: result.hasMore ? job.stage_rows_copied + result.batchRows : 0,
    hasMore: result.hasMore,
  });
}

async function readIntegrity(database: D1Database, channelId: string, control: boolean) {
  return database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM channel_reports
        WHERE channel_id IN (?, ?)) AS report_count,
      (SELECT COALESCE(SUM(projection_source_version), 0) FROM channel_reports
        WHERE channel_id IN (?, ?)) AS version_sum,
      (SELECT COUNT(*)
        FROM channel_reports AS report
        LEFT JOIN channel_report_projection_watermarks AS watermark
          ON watermark.report_id = report.id
        WHERE report.channel_id IN (?, ?)
          AND (
            watermark.report_id IS NULL
            OR watermark.channel_id IS NOT report.channel_id
            OR watermark.source_version != report.projection_source_version
            OR watermark.state != 'active'
          )) AS watermark_mismatch_count,
      ${control ? `(
        SELECT COUNT(*)
        FROM channel_reports AS report
        INNER JOIN channels AS channel ON channel.id = report.channel_id
        LEFT JOIN channel_report_control_projections AS projection
          ON projection.report_id = report.id
        WHERE report.channel_id IN (?, ?)
          AND (
            projection.report_id IS NULL
            OR projection.channel_id IS NOT report.channel_id
            OR projection.channel_name IS NOT channel.name
            OR projection.channel_owner_uid IS NOT channel.owner_uid
            OR projection.reporter_uid IS NOT report.reporter_uid
            OR projection.reporter_auth_uid IS NOT report.reporter_auth_uid
            OR projection.reporter_device_id IS NOT report.reporter_device_id
            OR projection.reason IS NOT report.reason
            OR projection.details IS NOT report.details
            OR projection.created_at IS NOT report.created_at
            OR projection.status IS NOT report.status
            OR projection.resolution_note IS NOT report.resolution_note
            OR projection.resolved_at IS NOT report.resolved_at
            OR projection.inbox_message_id IS NOT report.inbox_message_id
            OR projection.source_version != report.projection_source_version
          )
      )` : "0"} AS projection_mismatch_count,
      ${control ? "0" : `(
        SELECT COUNT(*)
        FROM channel_reports AS report
        WHERE report.channel_id IN (?, ?)
          AND NOT EXISTS (
            SELECT 1 FROM domain_events AS event
            WHERE event.channel_id = report.channel_id
              AND event.aggregate_type = 'channel_report'
              AND event.aggregate_id = report.id
              AND event.event_type = 'channel_report_projection_upsert'
              AND event.source_version = report.projection_source_version
          )
      )`} AS event_mismatch_count,
      (SELECT COUNT(*) FROM channel_report_control_projections
        WHERE channel_id IN (?, ?)) AS local_projection_count
  `).bind(
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
    ...(control ? [channelId, `${channelId}_live`] : []),
    ...(control ? [] : [channelId, `${channelId}_live`]),
    channelId, `${channelId}_live`,
  ).first<ReportIntegrityRow>();
}

export async function completeCanaryChannelReportReconciliation(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const destination = resolveCanaryProjectionSource(input.env, input.shardId).database;
  const job = await readJob(destination, input.channelId);
  if (!job) throw new Error("canary_channel_report_job_missing");
  if (job.status === "active" && job.stage === "delta_channel_reports_verified") {
    return response({ ...input, ...job, idempotent: true });
  }
  if (job.status !== "active" || job.stage !== "delta_channel_reports_copied") {
    return response({ ...input, ...job, idempotent: false, blockers: ["channel_report_reconciliation_incomplete"] });
  }
  const blocker = await sourceBlocker({
    source: input.env.DB,
    channelId: input.channelId,
    expectedVersion: job.source_projection_version,
  });
  if (blocker) {
    await markFailed(destination, input.channelId);
    return response({ ...input, ...job, status: "failed", idempotent: false, blockers: [blocker] });
  }
  const [source, copied] = await Promise.all([
    readIntegrity(input.env.DB, input.channelId, true),
    readIntegrity(destination, input.channelId, false),
  ]);
  if (!source || !copied) throw new Error("canary_channel_report_integrity_missing");
  const blockers: string[] = [];
  if (Number(source.report_count) !== Number(copied.report_count)) {
    blockers.push("channel_report_count_mismatch");
  }
  if (Number(source.version_sum) !== Number(copied.version_sum)) {
    blockers.push("channel_report_version_mismatch");
  }
  if (Number(source.watermark_mismatch_count) !== 0) {
    blockers.push("source_channel_report_watermark_mismatch");
  }
  if (Number(source.projection_mismatch_count) !== 0) {
    blockers.push("source_channel_report_projection_mismatch");
  }
  if (Number(copied.watermark_mismatch_count) !== 0) {
    blockers.push("destination_channel_report_watermark_mismatch");
  }
  if (Number(copied.event_mismatch_count) !== 0) {
    blockers.push("destination_channel_report_event_missing");
  }
  if (Number(copied.local_projection_count) !== 0) {
    blockers.push("destination_channel_report_projection_present");
  }
  if (blockers.length > 0) {
    return response({ ...input, ...job, idempotent: false, blockers });
  }
  const results = await destination.batch([
    destination.prepare(`
      DELETE FROM canary_channel_report_reconciliation_seen WHERE channel_id = ?
    `).bind(input.channelId),
    destination.prepare(`
      UPDATE canary_channel_copy_jobs
      SET stage = 'delta_channel_reports_verified', updated_at = ?
      WHERE channel_id = ? AND source_projection_version = ?
        AND stage = 'delta_channel_reports_copied' AND status = 'active'
    `).bind(new Date().toISOString(), input.channelId, job.source_projection_version),
  ]);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    throw new Error("canary_channel_report_reconciliation_not_completed");
  }
  return response({
    ...input,
    stage: "delta_channel_reports_verified",
    status: "active",
    idempotent: false,
  });
}
