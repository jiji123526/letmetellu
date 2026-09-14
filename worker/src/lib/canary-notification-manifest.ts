import type { Env } from "../types.ts";
import {
  type CanaryChannelCopyResult,
  type CopyStage,
} from "./canary-channel-copy.ts";
import {
  type CanaryShardId,
  resolveCanaryProjectionSource,
} from "./channel-projection-dispatcher.ts";

const OWNER_BATCH_SIZE = 40;

export const CANARY_CHANNEL_LOCAL_NOTIFICATION_TABLES = [
  "message_notification_owners",
  "dm_notification_owners",
] as const;

export const CANARY_CONTROL_ONLY_NOTIFICATION_TABLES = [
  "notification_preferences",
  "notification_outbox",
  "user_recent_channels",
  "cleanup_jobs",
] as const;

interface JobRow {
  source_projection_version: number;
  stage: CopyStage;
  status: "active" | "failed" | "abandoned" | "complete";
  cursor_created_at: string | null;
  cursor_row_id: string | null;
  stage_rows_copied: number;
}

interface OwnerRow extends Record<string, unknown> {
  message_id: string;
  channel_id: string;
  user_id: string;
  created_at: string;
}

interface ManifestCounts {
  message_notification_owner_count: number;
  orphan_message_notification_owner_count: number;
  control_only_row_count: number;
}

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

async function copyOwnerBatch(input: {
  destination: D1Database;
  source: D1Database;
  channelId: string;
  job: JobRow;
}) {
  const cursorCreatedAt = input.job.cursor_created_at || "";
  const cursorId = input.job.cursor_row_id || "";
  const rows = await input.source.prepare(`
    SELECT message_id, channel_id, user_id, created_at
    FROM message_notification_owners
    WHERE channel_id IN (?, ?)
      AND (
        ? = '' OR created_at > ? OR (created_at = ? AND message_id > ?)
      )
    ORDER BY created_at ASC, message_id ASC
    LIMIT ?
  `).bind(
    input.channelId,
    `${input.channelId}_live`,
    cursorCreatedAt,
    cursorCreatedAt,
    cursorCreatedAt,
    cursorId,
    OWNER_BATCH_SIZE + 1,
  ).all<OwnerRow>();
  const batch = rows.results.slice(0, OWNER_BATCH_SIZE);
  const hasMore = rows.results.length > OWNER_BATCH_SIZE;
  const last = batch.at(-1);
  const nextStage: CopyStage = hasMore
    ? "delta_message_notification_owners_copying"
    : "delta_message_notification_owners_pruning";
  const statements = batch.flatMap((row) => [
    input.destination.prepare(`
      INSERT INTO message_notification_owners (
        message_id, channel_id, user_id, created_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        channel_id = excluded.channel_id,
        user_id = excluded.user_id,
        created_at = excluded.created_at
    `).bind(row.message_id, row.channel_id, row.user_id, row.created_at),
    input.destination.prepare(`
      INSERT OR IGNORE INTO canary_notification_reconciliation_seen (
        channel_id, message_id
      ) VALUES (?, ?)
    `).bind(input.channelId, row.message_id),
  ]);
  statements.push(input.destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET stage = ?, cursor_created_at = ?, cursor_row_id = ?,
      stage_rows_copied = ?, updated_at = ?
    WHERE channel_id = ? AND source_projection_version = ?
      AND stage = 'delta_message_notification_owners_copying'
      AND status = 'active'
      AND COALESCE(cursor_created_at, '') = ?
      AND COALESCE(cursor_row_id, '') = ?
  `).bind(
    nextStage,
    hasMore ? last?.created_at || null : null,
    hasMore ? last?.message_id || null : null,
    hasMore ? Number(input.job.stage_rows_copied) + batch.length : 0,
    new Date().toISOString(),
    input.channelId,
    input.job.source_projection_version,
    cursorCreatedAt,
    cursorId,
  ));
  const results = await input.destination.batch(statements);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    throw new Error("canary_notification_owner_job_advanced");
  }
  return { nextStage, batchRows: batch.length, hasMore };
}

async function pruneOwnerBatch(input: {
  destination: D1Database;
  channelId: string;
  job: JobRow;
}) {
  const stale = await input.destination.prepare(`
    SELECT owner.message_id
    FROM message_notification_owners AS owner
    LEFT JOIN canary_notification_reconciliation_seen AS seen
      ON seen.channel_id = ? AND seen.message_id = owner.message_id
    WHERE owner.channel_id IN (?, ?) AND seen.message_id IS NULL
    ORDER BY owner.created_at ASC, owner.message_id ASC
    LIMIT ?
  `).bind(
    input.channelId,
    input.channelId,
    `${input.channelId}_live`,
    OWNER_BATCH_SIZE,
  ).all<{ message_id: string }>();
  const hasMore = stale.results.length === OWNER_BATCH_SIZE;
  const nextStage: CopyStage = hasMore
    ? "delta_message_notification_owners_pruning"
    : "delta_message_notification_owners_copied";
  const statements = stale.results.map((row) => input.destination.prepare(`
    DELETE FROM message_notification_owners
    WHERE message_id = ? AND channel_id IN (?, ?)
  `).bind(row.message_id, input.channelId, `${input.channelId}_live`));
  statements.push(input.destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET stage = ?, stage_rows_copied = ?, updated_at = ?
    WHERE channel_id = ? AND source_projection_version = ?
      AND stage = 'delta_message_notification_owners_pruning'
      AND status = 'active'
  `).bind(
    nextStage,
    hasMore ? Number(input.job.stage_rows_copied) + stale.results.length : 0,
    new Date().toISOString(),
    input.channelId,
    input.job.source_projection_version,
  ));
  const results = await input.destination.batch(statements);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    throw new Error("canary_notification_owner_prune_job_advanced");
  }
  return { nextStage, batchRows: stale.results.length, hasMore };
}

export async function reconcileCanaryMessageNotificationOwnersBatch(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const destination = resolveCanaryProjectionSource(input.env, input.shardId).database;
  let job = await readJob(destination, input.channelId);
  if (!job) throw new Error("canary_notification_manifest_job_missing");
  if (job.status === "active" && job.stage === "delta_dm_verified") {
    const update = await destination.prepare(`
      UPDATE canary_channel_copy_jobs
      SET stage = 'delta_message_notification_owners_copying',
        cursor_created_at = NULL, cursor_row_id = NULL,
        stage_rows_copied = 0, updated_at = ?
      WHERE channel_id = ? AND source_projection_version = ?
        AND stage = 'delta_dm_verified' AND status = 'active'
    `).bind(new Date().toISOString(), input.channelId, job.source_projection_version).run();
    if (Number(update.meta.changes || 0) !== 1) {
      throw new Error("canary_notification_manifest_job_not_started");
    }
    job = { ...job, stage: "delta_message_notification_owners_copying" };
  }
  if (
    job.status === "active"
    && (
      job.stage === "delta_message_notification_owners_copied"
      || job.stage === "delta_notification_manifest_verified"
    )
  ) {
    return response({ ...input, ...job, idempotent: true });
  }
  if (
    job.status !== "active"
    || (
      job.stage !== "delta_message_notification_owners_copying"
      && job.stage !== "delta_message_notification_owners_pruning"
    )
  ) {
    return response({ ...input, ...job, idempotent: false, blockers: ["notification_manifest_not_ready"] });
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
  const result = job.stage === "delta_message_notification_owners_copying"
    ? await copyOwnerBatch({ destination, source: input.env.DB, channelId: input.channelId, job })
    : await pruneOwnerBatch({ destination, channelId: input.channelId, job });
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

async function readCounts(database: D1Database, channelId: string) {
  return database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM message_notification_owners
        WHERE channel_id IN (?, ?)) AS message_notification_owner_count,
      (SELECT COUNT(*) FROM message_notification_owners AS owner
        LEFT JOIN messages AS message ON message.id = owner.message_id
        WHERE owner.channel_id IN (?, ?) AND message.id IS NULL)
        AS orphan_message_notification_owner_count,
      (
        (SELECT COUNT(*) FROM notification_preferences WHERE channel_id IN (?, ?))
        + (SELECT COUNT(*) FROM notification_outbox WHERE channel_id IN (?, ?))
        + (SELECT COUNT(*) FROM user_recent_channels WHERE channel_id IN (?, ?))
        + (SELECT COUNT(*) FROM cleanup_jobs
            WHERE resource_type = 'channel' AND resource_id IN (?, ?))
      ) AS control_only_row_count
  `).bind(
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
  ).first<ManifestCounts>();
}

export async function completeCanaryNotificationManifest(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const destination = resolveCanaryProjectionSource(input.env, input.shardId).database;
  const job = await readJob(destination, input.channelId);
  if (!job) throw new Error("canary_notification_manifest_job_missing");
  if (job.status === "active" && job.stage === "delta_notification_manifest_verified") {
    return response({ ...input, ...job, idempotent: true });
  }
  if (job.status !== "active" || job.stage !== "delta_message_notification_owners_copied") {
    return response({ ...input, ...job, idempotent: false, blockers: ["notification_owner_reconciliation_incomplete"] });
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
  const [sourceCounts, destinationCounts] = await Promise.all([
    readCounts(input.env.DB, input.channelId),
    readCounts(destination, input.channelId),
  ]);
  if (!sourceCounts || !destinationCounts) throw new Error("canary_notification_manifest_counts_missing");
  const blockers: string[] = [];
  if (
    Number(sourceCounts.message_notification_owner_count)
    !== Number(destinationCounts.message_notification_owner_count)
  ) blockers.push("message_notification_owner_count_mismatch");
  if (Number(destinationCounts.orphan_message_notification_owner_count) !== 0) {
    blockers.push("message_notification_owner_orphan");
  }
  if (Number(destinationCounts.control_only_row_count) !== 0) {
    blockers.push("control_only_notification_state_present");
  }
  if (blockers.length > 0) {
    return response({ ...input, ...job, idempotent: false, blockers });
  }
  const results = await destination.batch([
    destination.prepare(`
      DELETE FROM canary_notification_reconciliation_seen WHERE channel_id = ?
    `).bind(input.channelId),
    destination.prepare(`
      UPDATE canary_channel_copy_jobs
      SET stage = 'delta_notification_manifest_verified', updated_at = ?
      WHERE channel_id = ? AND source_projection_version = ?
        AND stage = 'delta_message_notification_owners_copied'
        AND status = 'active'
    `).bind(new Date().toISOString(), input.channelId, job.source_projection_version),
  ]);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    throw new Error("canary_notification_manifest_not_completed");
  }
  return response({
    ...input,
    stage: "delta_notification_manifest_verified",
    status: "active",
    idempotent: false,
  });
}
