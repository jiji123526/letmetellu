import type { Env } from "../types.ts";
import {
  CANARY_MESSAGE_COPY_COLUMNS,
  type CanaryChannelCopyResult,
  type CopyStage,
} from "./canary-channel-copy.ts";
import {
  type CanaryShardId,
  resolveCanaryProjectionSource,
} from "./channel-projection-dispatcher.ts";
import { verifyCanaryMessageDerivedState } from "./canary-message-derived-verification.ts";

const DELTA_BATCH_SIZE = 40;

interface DeltaJobRow {
  source_projection_version: number;
  stage: CopyStage;
  status: "active" | "failed" | "abandoned" | "complete";
  cursor_created_at: string | null;
  cursor_row_id: string | null;
  message_snapshot_created_at: string | null;
  message_snapshot_id: string | null;
  stage_rows_copied: number;
}

interface SourceStateRow {
  projection_source_version: number;
  active_undo_rows: number;
}

interface DeltaRow extends Record<string, unknown> {
  id: string;
  __cursor_created_at: string;
}

async function readJob(destination: D1Database, channelId: string) {
  return destination.prepare(`
    SELECT source_projection_version, stage, status,
      cursor_created_at, cursor_row_id,
      message_snapshot_created_at, message_snapshot_id, stage_rows_copied
    FROM canary_channel_copy_jobs
    WHERE channel_id = ?
  `).bind(channelId).first<DeltaJobRow>();
}

async function sourceBlocker(input: {
  source: D1Database;
  channelId: string;
  expectedVersion: number;
}): Promise<string | null> {
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
  ).first<SourceStateRow>();
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
    ...(input.batchRowsCopied === undefined
      ? {}
      : { batchRowsCopied: input.batchRowsCopied }),
    ...(input.stageRowsCopied === undefined
      ? {}
      : { stageRowsCopied: input.stageRowsCopied }),
    ...(input.hasMore === undefined ? {} : { hasMore: input.hasMore }),
  };
}

export async function startCanaryMessageDelta(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const destination = resolveCanaryProjectionSource(input.env, input.shardId).database;
  const job = await readJob(destination, input.channelId);
  if (!job) {
    return response({
      ...input,
      stage: "prepared",
      status: "failed",
      idempotent: false,
      blockers: ["copy_job_missing"],
    });
  }
  if (job.status !== "active") {
    return response({ ...input, ...job, idempotent: true, blockers: ["copy_job_not_active"] });
  }
  if (job.stage !== "message_links_rebuilt") {
    if (job.stage.startsWith("delta_")) {
      return response({ ...input, ...job, idempotent: true });
    }
    return response({
      ...input,
      ...job,
      idempotent: false,
      blockers: ["message_dependents_required"],
    });
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
  const snapshot = await input.env.DB.prepare(`
    SELECT id, created_at
    FROM messages
    WHERE channel_id IN (?, ?)
    ORDER BY COALESCE(created_at, '') DESC, id DESC
    LIMIT 1
  `).bind(input.channelId, `${input.channelId}_live`).first<{
    id: string;
    created_at: string | null;
  }>();
  const nextStage: CopyStage = snapshot ? "delta_roots_upserting" : "delta_pruning";
  const results = await destination.batch([
    destination.prepare(`
      DELETE FROM canary_message_reconciliation_seen WHERE channel_id = ?
    `).bind(input.channelId),
    destination.prepare(`
      UPDATE canary_channel_copy_jobs
      SET stage = ?, cursor_created_at = NULL, cursor_row_id = NULL,
          message_snapshot_created_at = ?, message_snapshot_id = ?,
          stage_rows_copied = 0, updated_at = ?
      WHERE channel_id = ? AND source_projection_version = ?
        AND stage = 'message_links_rebuilt' AND status = 'active'
    `).bind(
      nextStage,
      snapshot?.created_at ?? null,
      snapshot?.id ?? null,
      new Date().toISOString(),
      input.channelId,
      job.source_projection_version,
    ),
  ]);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    const current = await readJob(destination, input.channelId);
    if (!current) throw new Error("canary_delta_job_missing_after_start");
    return response({ ...input, ...current, idempotent: true, blockers: ["copy_job_advanced"] });
  }
  return response({ ...input, stage: nextStage, status: "active", idempotent: false, hasMore: true });
}

function readDeltaRows(input: {
  source: D1Database;
  channelId: string;
  roots: boolean;
  snapshotCreatedAt: string;
  snapshotId: string;
  cursorCreatedAt: string | null;
  cursorId: string | null;
}) {
  const cursorCreatedAt = input.cursorCreatedAt || "";
  const cursorId = input.cursorId || "";
  return input.source.prepare(`
    SELECT ${CANARY_MESSAGE_COPY_COLUMNS.join(", ")},
      COALESCE(created_at, '') AS __cursor_created_at
    FROM messages
    WHERE channel_id IN (?, ?)
      AND ${input.roots ? "reply_to IS NULL" : "reply_to IS NOT NULL"}
      AND (
        COALESCE(created_at, '') < ?
        OR (COALESCE(created_at, '') = ? AND id <= ?)
      )
      AND (
        ? = '' OR COALESCE(created_at, '') > ?
        OR (COALESCE(created_at, '') = ? AND id > ?)
      )
    ORDER BY COALESCE(created_at, '') ASC, id ASC
    LIMIT ?
  `).bind(
    input.channelId,
    `${input.channelId}_live`,
    input.snapshotCreatedAt,
    input.snapshotCreatedAt,
    input.snapshotId,
    cursorCreatedAt,
    cursorCreatedAt,
    cursorCreatedAt,
    cursorId,
    DELTA_BATCH_SIZE + 1,
  ).all<DeltaRow>();
}

function upsertMessage(destination: D1Database, row: DeltaRow) {
  const updateColumns = CANARY_MESSAGE_COPY_COLUMNS.filter((column) => column !== "id");
  return destination.prepare(`
    INSERT INTO messages (${CANARY_MESSAGE_COPY_COLUMNS.join(", ")})
    VALUES (${CANARY_MESSAGE_COPY_COLUMNS.map(() => "?").join(", ")})
    ON CONFLICT(id) DO UPDATE SET
      ${updateColumns.map((column) => `${column} = excluded.${column}`).join(", ")}
  `).bind(...CANARY_MESSAGE_COPY_COLUMNS.map((column) => row[column] ?? null));
}

export async function reconcileCanaryMessageDeltaBatch(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const destination = resolveCanaryProjectionSource(input.env, input.shardId).database;
  const job = await readJob(destination, input.channelId);
  if (!job) throw new Error("canary_delta_job_missing");
  if (job.status !== "active") {
    return response({ ...input, ...job, idempotent: true, blockers: ["copy_job_not_active"] });
  }
  if (job.stage === "delta_pruning") {
    return pruneCanaryMessageDeltaBatch({ ...input, destination, job });
  }
  if (job.stage !== "delta_roots_upserting" && job.stage !== "delta_messages_upserting") {
    return response({
      ...input,
      ...job,
      idempotent: true,
      blockers: job.stage === "delta_messages_copied"
        || job.stage === "delta_message_actors_copied"
        || job.stage === "delta_links_rebuilt"
        ? []
        : ["delta_stage_required"],
      hasMore: false,
    });
  }
  if (!job.message_snapshot_id || job.message_snapshot_created_at === null) {
    throw new Error("canary_delta_snapshot_missing");
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
  const roots = job.stage === "delta_roots_upserting";
  const rows = await readDeltaRows({
    source: input.env.DB,
    channelId: input.channelId,
    roots,
    snapshotCreatedAt: job.message_snapshot_created_at,
    snapshotId: job.message_snapshot_id,
    cursorCreatedAt: job.cursor_created_at,
    cursorId: job.cursor_row_id,
  });
  const batchRows = rows.results.slice(0, DELTA_BATCH_SIZE);
  const hasMore = rows.results.length > DELTA_BATCH_SIZE;
  const last = batchRows.at(-1);
  const nextStage: CopyStage = hasMore
    ? job.stage
    : roots ? "delta_messages_upserting" : "delta_pruning";
  const statements = batchRows.flatMap((row) => [
    upsertMessage(destination, row),
    destination.prepare(`
      INSERT OR IGNORE INTO canary_message_reconciliation_seen (channel_id, message_id)
      VALUES (?, ?)
    `).bind(input.channelId, row.id),
  ]);
  statements.push(destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET stage = ?, cursor_created_at = ?, cursor_row_id = ?,
      stage_rows_copied = ?, updated_at = ?
    WHERE channel_id = ? AND source_projection_version = ?
      AND stage = ? AND status = 'active'
      AND COALESCE(cursor_created_at, '') = ?
      AND COALESCE(cursor_row_id, '') = ?
  `).bind(
    nextStage,
    hasMore ? last?.__cursor_created_at || null : null,
    hasMore ? last?.id || null : null,
    hasMore ? Number(job.stage_rows_copied || 0) + batchRows.length : 0,
    new Date().toISOString(),
    input.channelId,
    job.source_projection_version,
    job.stage,
    job.cursor_created_at || "",
    job.cursor_row_id || "",
  ));
  const results = await destination.batch(statements);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    const current = await readJob(destination, input.channelId);
    if (!current) throw new Error("canary_delta_job_missing_after_batch");
    return response({ ...input, ...current, idempotent: true, blockers: ["copy_job_advanced"] });
  }
  return response({
    ...input,
    stage: nextStage,
    status: "active",
    idempotent: false,
    batchRowsCopied: batchRows.length,
    stageRowsCopied: Number(job.stage_rows_copied || 0) + batchRows.length,
    hasMore: nextStage !== "delta_pruning" || hasMore,
  });
}

export async function completeCanaryMessageDelta(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const destination = resolveCanaryProjectionSource(input.env, input.shardId).database;
  const job = await readJob(destination, input.channelId);
  if (!job) throw new Error("canary_delta_job_missing");
  if (job.status === "complete" && job.stage === "delta_links_rebuilt") {
    return response({ ...input, ...job, idempotent: true });
  }
  if (job.status !== "active" || job.stage !== "delta_links_rebuilt") {
    return response({
      ...input,
      ...job,
      idempotent: false,
      blockers: ["delta_dependents_incomplete"],
    });
  }
  const verified = await verifyCanaryMessageDerivedState(input);
  if (!verified.ready) {
    return response({
      ...input,
      ...job,
      idempotent: false,
      blockers: verified.blockers,
    });
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
  const update = await destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET status = 'complete', updated_at = ?
    WHERE channel_id = ? AND source_projection_version = ?
      AND stage = 'delta_links_rebuilt' AND status = 'active'
  `).bind(
    new Date().toISOString(),
    input.channelId,
    job.source_projection_version,
  ).run();
  if (Number(update.meta.changes || 0) !== 1) {
    const current = await readJob(destination, input.channelId);
    if (!current) throw new Error("canary_delta_job_missing_after_complete");
    return response({ ...input, ...current, idempotent: true, blockers: ["copy_job_advanced"] });
  }
  return response({
    ...input,
    stage: "delta_links_rebuilt",
    status: "complete",
    idempotent: false,
  });
}

async function pruneCanaryMessageDeltaBatch(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
  destination: D1Database;
  job: DeltaJobRow;
}): Promise<CanaryChannelCopyResult> {
  const rows = await input.destination.prepare(`
    SELECT id
    FROM messages
    WHERE channel_id IN (?, ?)
      AND NOT EXISTS (
        SELECT 1 FROM canary_message_reconciliation_seen AS seen
        WHERE seen.channel_id = ? AND seen.message_id = messages.id
      )
    ORDER BY COALESCE(created_at, '') ASC, id ASC
    LIMIT ?
  `).bind(
    input.channelId,
    `${input.channelId}_live`,
    input.channelId,
    DELTA_BATCH_SIZE + 1,
  ).all<{ id: string }>();
  const batchRows = rows.results.slice(0, DELTA_BATCH_SIZE);
  const hasMore = rows.results.length > DELTA_BATCH_SIZE;
  const statements = batchRows.map((row) => (
    input.destination.prepare("DELETE FROM messages WHERE id = ?").bind(row.id)
  ));
  if (hasMore) {
    statements.push(input.destination.prepare(`
      UPDATE canary_channel_copy_jobs
      SET stage_rows_copied = stage_rows_copied + ?, updated_at = ?
      WHERE channel_id = ? AND source_projection_version = ?
        AND stage = 'delta_pruning' AND status = 'active'
    `).bind(
      batchRows.length,
      new Date().toISOString(),
      input.channelId,
      input.job.source_projection_version,
    ));
  } else {
    statements.push(
      input.destination.prepare(`
        DELETE FROM message_actor_identities WHERE channel_id IN (?, ?)
      `).bind(input.channelId, `${input.channelId}_live`),
      input.destination.prepare(`
        DELETE FROM message_links WHERE channel_id IN (?, ?)
      `).bind(input.channelId, `${input.channelId}_live`),
      input.destination.prepare(`
        DELETE FROM canary_message_reconciliation_seen WHERE channel_id = ?
      `).bind(input.channelId),
      input.destination.prepare(`
        UPDATE canary_channel_copy_jobs
        SET stage = ?, cursor_created_at = NULL, cursor_row_id = NULL,
          stage_rows_copied = 0, updated_at = ?
        WHERE channel_id = ? AND source_projection_version = ?
          AND stage = 'delta_pruning' AND status = 'active'
      `).bind(
        input.job.message_snapshot_id ? "delta_messages_copied" : "delta_links_rebuilt",
        new Date().toISOString(),
        input.channelId,
        input.job.source_projection_version,
      ),
    );
  }
  const results = await input.destination.batch(statements);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    throw new Error("canary_delta_prune_job_not_advanced");
  }
  const nextStage: CopyStage = hasMore
    ? "delta_pruning"
    : input.job.message_snapshot_id ? "delta_messages_copied" : "delta_links_rebuilt";
  return response({
    ...input,
    stage: nextStage,
    status: "active",
    idempotent: false,
    batchRowsCopied: batchRows.length,
    stageRowsCopied: Number(input.job.stage_rows_copied || 0) + batchRows.length,
    hasMore,
  });
}
