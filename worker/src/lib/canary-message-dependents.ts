import type { Env } from "../types.ts";
import type {
  CanaryChannelCopyResult,
  CopyStage,
} from "./canary-channel-copy.ts";
import {
  type CanaryShardId,
  resolveCanaryProjectionSource,
} from "./channel-projection-dispatcher.ts";

const DEPENDENT_COPY_BATCH_SIZE = 100;

interface CopyJobRow {
  channel_id: string;
  source_projection_version: number;
  stage: CopyStage;
  status: "active" | "failed" | "complete";
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

interface DependentCopyRow extends Record<string, unknown> {
  __cursor_created_at: string;
  __cursor_row_id: string;
}

const ACTOR_COLUMNS = [
  "record_id",
  "record_type",
  "channel_id",
  "uid",
  "device_id_hash",
  "created_at",
] as const;

async function readJob(
  destination: D1Database,
  channelId: string,
): Promise<CopyJobRow | null> {
  return destination.prepare(`
    SELECT
      channel_id,
      source_projection_version,
      stage,
      status,
      cursor_created_at,
      cursor_row_id,
      message_snapshot_created_at,
      message_snapshot_id,
      stage_rows_copied
    FROM canary_channel_copy_jobs
    WHERE channel_id = ?
  `).bind(channelId).first<CopyJobRow>();
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
        SELECT 1
        FROM pending_admin_deletions
        WHERE channel_id IN (?, ?)
        LIMIT 1
      ) AS active_undo_rows
    FROM channels AS channel
    WHERE channel.id = ?
  `).bind(
    input.channelId,
    `${input.channelId}_live`,
    input.channelId,
  ).first<SourceStateRow>();
  if (
    !row
    || Number(row.projection_source_version) !== Number(input.expectedVersion)
  ) {
    return "source_version_changed";
  }
  return Number(row.active_undo_rows) > 0 ? "source_undo_active" : null;
}

async function markFailed(
  destination: D1Database,
  channelId: string,
): Promise<void> {
  await destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET status = 'failed', updated_at = ?
    WHERE channel_id = ? AND status = 'active'
  `).bind(new Date().toISOString(), channelId).run();
}

function readActorRows(input: {
  source: D1Database;
  channelId: string;
  snapshotCreatedAt: string;
  snapshotId: string;
  cursorCreatedAt: string | null;
  cursorId: string | null;
}) {
  const cursorCreatedAt = input.cursorCreatedAt || "";
  const cursorId = input.cursorId || "";
  return input.source.prepare(`
    SELECT
      actor.record_id,
      actor.record_type,
      actor.channel_id,
      actor.uid,
      actor.device_id_hash,
      actor.created_at,
      COALESCE(actor.created_at, '') AS __cursor_created_at,
      actor.record_id AS __cursor_row_id
    FROM message_actor_identities AS actor
    INNER JOIN messages AS message
      ON message.id = actor.record_id
    WHERE actor.record_type = 'message'
      AND actor.channel_id = ?
      AND message.channel_id IN (?, ?)
      AND (
        COALESCE(message.created_at, '') < ?
        OR (COALESCE(message.created_at, '') = ? AND message.id <= ?)
      )
      AND (
        ? = ''
        OR COALESCE(actor.created_at, '') > ?
        OR (COALESCE(actor.created_at, '') = ? AND actor.record_id > ?)
      )
    ORDER BY COALESCE(actor.created_at, '') ASC, actor.record_id ASC
    LIMIT ?
  `).bind(
    input.channelId,
    input.channelId,
    `${input.channelId}_live`,
    input.snapshotCreatedAt,
    input.snapshotCreatedAt,
    input.snapshotId,
    cursorCreatedAt,
    cursorCreatedAt,
    cursorCreatedAt,
    cursorId,
    DEPENDENT_COPY_BATCH_SIZE + 1,
  ).all<DependentCopyRow>();
}

function readLinkRows(input: {
  destination: D1Database;
  channelId: string;
  snapshotCreatedAt: string;
  snapshotId: string;
  cursorCreatedAt: string | null;
  cursorId: string | null;
}) {
  const cursorCreatedAt = input.cursorCreatedAt || "";
  const cursorId = input.cursorId || "";
  return input.destination.prepare(`
    SELECT
      id AS message_id,
      channel_id,
      created_at,
      COALESCE(created_at, '') AS __cursor_created_at,
      id AS __cursor_row_id
    FROM messages
    WHERE channel_id IN (?, ?)
      AND deleted = 0
      AND (
        instr(text, 'http://') > 0
        OR instr(text, 'https://') > 0
        OR instr(text, 'www.') > 0
      )
      AND (
        COALESCE(created_at, '') < ?
        OR (COALESCE(created_at, '') = ? AND id <= ?)
      )
      AND (
        ? = ''
        OR COALESCE(created_at, '') > ?
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
    DEPENDENT_COPY_BATCH_SIZE + 1,
  ).all<DependentCopyRow>();
}

function actorInsert(
  destination: D1Database,
  row: DependentCopyRow,
): D1PreparedStatement {
  return destination.prepare(`
    INSERT INTO message_actor_identities (${ACTOR_COLUMNS.join(", ")})
    VALUES (${ACTOR_COLUMNS.map(() => "?").join(", ")})
  `).bind(...ACTOR_COLUMNS.map((column) => row[column] ?? null));
}

function linkInsert(
  destination: D1Database,
  row: DependentCopyRow,
): D1PreparedStatement {
  return destination.prepare(`
    INSERT INTO message_links (message_id, channel_id, created_at)
    VALUES (?, ?, ?)
  `).bind(row.message_id, row.channel_id, row.created_at);
}

export async function copyCanaryMessageDependentsBatch(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const destination = resolveCanaryProjectionSource(
    input.env,
    input.shardId,
  ).database;
  const job = await readJob(destination, input.channelId);
  if (!job) {
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: "prepared",
      status: "failed",
      idempotent: false,
      blockers: ["copy_job_missing"],
    };
  }
  if (job.status !== "active") {
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: job.stage,
      status: job.status,
      idempotent: true,
      blockers: ["copy_job_not_active"],
    };
  }
  if (job.stage === "message_links_rebuilt" || job.stage === "delta_links_rebuilt") {
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: job.stage,
      status: job.status,
      idempotent: true,
      blockers: [],
      batchRowsCopied: 0,
      stageRowsCopied: Number(job.stage_rows_copied || 0),
      hasMore: false,
    };
  }
  if (
    job.stage !== "messages_copied"
    && job.stage !== "message_actors_copied"
    && job.stage !== "delta_messages_copied"
    && job.stage !== "delta_message_actors_copied"
  ) {
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: job.stage,
      status: job.status,
      idempotent: true,
      blockers: ["message_stage_required"],
    };
  }
  if (!job.message_snapshot_id || job.message_snapshot_created_at === null) {
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: job.stage,
      status: "failed",
      idempotent: false,
      blockers: ["message_snapshot_missing"],
    };
  }

  const blocker = await sourceBlocker({
    source: input.env.DB,
    channelId: input.channelId,
    expectedVersion: job.source_projection_version,
  });
  if (blocker) {
    await markFailed(destination, input.channelId);
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: job.stage,
      status: "failed",
      idempotent: false,
      blockers: [blocker],
    };
  }

  const delta = job.stage.startsWith("delta_");
  const actors = job.stage === "messages_copied"
    || job.stage === "delta_messages_copied";
  const sourceResult = actors
    ? await readActorRows({
        source: input.env.DB,
        channelId: input.channelId,
        snapshotCreatedAt: job.message_snapshot_created_at,
        snapshotId: job.message_snapshot_id,
        cursorCreatedAt: job.cursor_created_at,
        cursorId: job.cursor_row_id,
      })
    : await readLinkRows({
        destination,
        channelId: input.channelId,
        snapshotCreatedAt: job.message_snapshot_created_at,
        snapshotId: job.message_snapshot_id,
        cursorCreatedAt: job.cursor_created_at,
        cursorId: job.cursor_row_id,
      });
  const batchRows = sourceResult.results.slice(0, DEPENDENT_COPY_BATCH_SIZE);
  const hasMore = sourceResult.results.length > DEPENDENT_COPY_BATCH_SIZE;
  const lastRow = batchRows.at(-1);
  const completedStageRows = Number(job.stage_rows_copied || 0)
    + batchRows.length;
  const nextStage: CopyStage = hasMore
    ? job.stage
    : actors
      ? delta ? "delta_message_actors_copied" : "message_actors_copied"
      : delta ? "delta_links_rebuilt" : "message_links_rebuilt";
  const statements = [
    ...batchRows.map((row) => (
      actors ? actorInsert(destination, row) : linkInsert(destination, row)
    )),
    destination.prepare(`
      UPDATE canary_channel_copy_jobs
      SET stage = ?,
          cursor_created_at = ?,
          cursor_row_id = ?,
          stage_rows_copied = ?,
          updated_at = ?
      WHERE channel_id = ?
        AND source_projection_version = ?
        AND stage = ?
        AND status = 'active'
        AND COALESCE(cursor_created_at, '') = ?
        AND COALESCE(cursor_row_id, '') = ?
        AND message_snapshot_created_at = ?
        AND message_snapshot_id = ?
    `).bind(
      nextStage,
      hasMore ? lastRow?.__cursor_created_at || null : null,
      hasMore ? lastRow?.__cursor_row_id || null : null,
      hasMore ? completedStageRows : 0,
      new Date().toISOString(),
      input.channelId,
      job.source_projection_version,
      job.stage,
      job.cursor_created_at || "",
      job.cursor_row_id || "",
      job.message_snapshot_created_at,
      job.message_snapshot_id,
    ),
  ];
  const results = await destination.batch(statements);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    const current = await readJob(destination, input.channelId);
    if (!current) throw new Error("canary_copy_job_missing_after_batch");
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: current.stage,
      status: current.status,
      idempotent: true,
      blockers: ["copy_job_advanced"],
      batchRowsCopied: 0,
      stageRowsCopied: Number(current.stage_rows_copied || 0),
      hasMore: current.stage === job.stage,
    };
  }

  const afterBlocker = await sourceBlocker({
    source: input.env.DB,
    channelId: input.channelId,
    expectedVersion: job.source_projection_version,
  });
  if (afterBlocker) {
    await markFailed(destination, input.channelId);
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: nextStage,
      status: "failed",
      idempotent: false,
      blockers: [afterBlocker],
      batchRowsCopied: batchRows.length,
      stageRowsCopied: completedStageRows,
      hasMore,
    };
  }

  return {
    shardId: input.shardId,
    channelId: input.channelId,
    stage: nextStage,
    status: "active",
    idempotent: false,
    blockers: [],
    batchRowsCopied: batchRows.length,
    stageRowsCopied: completedStageRows,
    hasMore,
  };
}
