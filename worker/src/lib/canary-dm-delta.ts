import type { Env } from "../types.ts";
import {
  CANARY_DM_COPY_COLUMNS,
  CANARY_DM_REPLY_COPY_COLUMNS,
  type CanaryChannelCopyResult,
  type CopyStage,
} from "./canary-channel-copy.ts";
import {
  type CanaryShardId,
  resolveCanaryProjectionSource,
} from "./channel-projection-dispatcher.ts";

const DM_DELTA_BATCH_SIZE = 40;

interface DmDeltaJobRow {
  source_projection_version: number;
  stage: CopyStage;
  status: "active" | "failed" | "abandoned" | "complete";
  cursor_created_at: string | null;
  cursor_row_id: string | null;
  stage_rows_copied: number;
}

interface CursorRow extends Record<string, unknown> {
  id: string;
  __cursor_created_at: string;
}

interface DependentRow extends Record<string, unknown> {
  __cursor_created_at: string;
  __cursor_row_id: string;
}

interface DmVerificationCounts {
  dm_count: number;
  reply_count: number;
  actor_count: number;
  notification_owner_count: number;
  orphan_reply_count: number;
  orphan_actor_count: number;
  orphan_notification_owner_count: number;
  activity_mismatch_count: number;
}

const DM_STAGES = new Set<CopyStage>([
  "delta_dm_roots_upserting",
  "delta_dm_replies_upserting",
  "delta_dm_replies_pruning",
  "delta_dm_roots_pruning",
  "delta_dm_actors_copying",
  "delta_dm_notification_owners_copying",
  "delta_dm_dependents_copied",
  "delta_dm_verified",
]);

export function isCanaryDmDeltaStage(stage: CopyStage): boolean {
  return DM_STAGES.has(stage);
}

async function readJob(destination: D1Database, channelId: string) {
  return destination.prepare(`
    SELECT source_projection_version, stage, status,
      cursor_created_at, cursor_row_id, stage_rows_copied
    FROM canary_channel_copy_jobs
    WHERE channel_id = ?
  `).bind(channelId).first<DmDeltaJobRow>();
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

function canonicalUpsert(
  destination: D1Database,
  table: "dm" | "dm_replies",
  columns: readonly string[],
  row: Record<string, unknown>,
) {
  const updateColumns = columns.filter((column) => column !== "id");
  return destination.prepare(`
    INSERT INTO ${table} (${columns.join(", ")})
    VALUES (${columns.map(() => "?").join(", ")})
    ON CONFLICT(id) DO UPDATE SET
      ${updateColumns.map((column) => `${column} = excluded.${column}`).join(", ")}
  `).bind(...columns.map((column) => row[column] ?? null));
}

function readCanonicalRows(input: {
  source: D1Database;
  table: "dm" | "dm_replies";
  columns: readonly string[];
  channelId: string;
  cursorCreatedAt: string | null;
  cursorId: string | null;
}) {
  const cursorCreatedAt = input.cursorCreatedAt || "";
  const cursorId = input.cursorId || "";
  return input.source.prepare(`
    SELECT ${input.columns.join(", ")}, COALESCE(created_at, '') AS __cursor_created_at
    FROM ${input.table}
    WHERE channel_id IN (?, ?)
      AND (
        ? = '' OR COALESCE(created_at, '') > ?
        OR (COALESCE(created_at, '') = ? AND id > ?)
      )
    ORDER BY COALESCE(created_at, '') ASC, id ASC
    LIMIT ?
  `).bind(
    input.channelId,
    `${input.channelId}_live`,
    cursorCreatedAt,
    cursorCreatedAt,
    cursorCreatedAt,
    cursorId,
    DM_DELTA_BATCH_SIZE + 1,
  ).all<CursorRow>();
}

async function copyCanonicalBatch(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
  destination: D1Database;
  job: DmDeltaJobRow;
  table: "dm" | "dm_replies";
  recordType: "dm" | "dm_reply";
  columns: readonly string[];
  nextStage: CopyStage;
}): Promise<CanaryChannelCopyResult> {
  const blocker = await sourceBlocker({
    source: input.env.DB,
    channelId: input.channelId,
    expectedVersion: input.job.source_projection_version,
  });
  if (blocker) {
    await markFailed(input.destination, input.channelId);
    return response({
      ...input,
      stage: input.job.stage,
      status: "failed",
      idempotent: false,
      blockers: [blocker],
    });
  }
  const rows = await readCanonicalRows({
    source: input.env.DB,
    table: input.table,
    columns: input.columns,
    channelId: input.channelId,
    cursorCreatedAt: input.job.cursor_created_at,
    cursorId: input.job.cursor_row_id,
  });
  const batchRows = rows.results.slice(0, DM_DELTA_BATCH_SIZE);
  const hasMore = rows.results.length > DM_DELTA_BATCH_SIZE;
  const last = batchRows.at(-1);
  const nextStage = hasMore ? input.job.stage : input.nextStage;
  const statements = batchRows.flatMap((row) => [
    canonicalUpsert(input.destination, input.table, input.columns, row),
    input.destination.prepare(`
      INSERT OR IGNORE INTO canary_dm_reconciliation_seen (
        channel_id, record_type, record_id
      ) VALUES (?, ?, ?)
    `).bind(input.channelId, input.recordType, row.id),
  ]);
  statements.push(input.destination.prepare(`
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
    hasMore ? Number(input.job.stage_rows_copied) + batchRows.length : 0,
    new Date().toISOString(),
    input.channelId,
    input.job.source_projection_version,
    input.job.stage,
    input.job.cursor_created_at || "",
    input.job.cursor_row_id || "",
  ));
  const results = await input.destination.batch(statements);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    const current = await readJob(input.destination, input.channelId);
    if (!current) throw new Error("canary_dm_job_missing_after_batch");
    return response({ ...input, ...current, idempotent: true, blockers: ["copy_job_advanced"] });
  }
  return response({
    ...input,
    stage: nextStage,
    status: "active",
    idempotent: false,
    batchRowsCopied: batchRows.length,
    stageRowsCopied: Number(input.job.stage_rows_copied) + batchRows.length,
    hasMore,
  });
}

async function pruneBatch(input: {
  shardId: CanaryShardId;
  channelId: string;
  destination: D1Database;
  job: DmDeltaJobRow;
  table: "dm" | "dm_replies";
  recordType: "dm" | "dm_reply";
  nextStage: CopyStage;
}) {
  const rows = await input.destination.prepare(`
    SELECT id FROM ${input.table}
    WHERE channel_id IN (?, ?)
      AND NOT EXISTS (
        SELECT 1 FROM canary_dm_reconciliation_seen AS seen
        WHERE seen.channel_id = ? AND seen.record_type = ?
          AND seen.record_id = ${input.table}.id
      )
    ORDER BY COALESCE(created_at, '') ASC, id ASC
    LIMIT ?
  `).bind(
    input.channelId,
    `${input.channelId}_live`,
    input.channelId,
    input.recordType,
    DM_DELTA_BATCH_SIZE + 1,
  ).all<{ id: string }>();
  const batchRows = rows.results.slice(0, DM_DELTA_BATCH_SIZE);
  const hasMore = rows.results.length > DM_DELTA_BATCH_SIZE;
  const statements = batchRows.map((row) => (
    input.destination.prepare(`DELETE FROM ${input.table} WHERE id = ?`).bind(row.id)
  ));
  if (!hasMore && input.table === "dm") {
    statements.push(
      input.destination.prepare(`
        DELETE FROM message_actor_identities
        WHERE record_type = 'dm' AND channel_id IN (?, ?)
      `).bind(input.channelId, `${input.channelId}_live`),
      input.destination.prepare(`
        DELETE FROM dm_notification_owners WHERE channel_id IN (?, ?)
      `).bind(input.channelId, `${input.channelId}_live`),
    );
  }
  statements.push(input.destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET stage = ?, cursor_created_at = NULL, cursor_row_id = NULL,
      stage_rows_copied = ?, updated_at = ?
    WHERE channel_id = ? AND source_projection_version = ?
      AND stage = ? AND status = 'active'
  `).bind(
    hasMore ? input.job.stage : input.nextStage,
    hasMore ? Number(input.job.stage_rows_copied) + batchRows.length : 0,
    new Date().toISOString(),
    input.channelId,
    input.job.source_projection_version,
    input.job.stage,
  ));
  const results = await input.destination.batch(statements);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    throw new Error("canary_dm_prune_job_not_advanced");
  }
  return response({
    ...input,
    stage: hasMore ? input.job.stage : input.nextStage,
    status: "active",
    idempotent: false,
    batchRowsCopied: batchRows.length,
    stageRowsCopied: Number(input.job.stage_rows_copied) + batchRows.length,
    hasMore,
  });
}

function readDependentRows(input: {
  source: D1Database;
  channelId: string;
  actors: boolean;
  cursorCreatedAt: string | null;
  cursorId: string | null;
}) {
  const cursorCreatedAt = input.cursorCreatedAt || "";
  const cursorId = input.cursorId || "";
  const select = input.actors
    ? `actor.record_id, actor.record_type, actor.channel_id, actor.uid,
       actor.device_id_hash, actor.created_at,
       COALESCE(actor.created_at, '') AS __cursor_created_at,
       actor.record_id AS __cursor_row_id`
    : `owner.dm_id, owner.channel_id, owner.user_id, owner.created_at,
       COALESCE(owner.created_at, '') AS __cursor_created_at,
       owner.dm_id AS __cursor_row_id`;
  const from = input.actors
    ? `message_actor_identities AS actor
       INNER JOIN dm ON dm.id = actor.record_id
         AND actor.record_type = 'dm'`
    : `dm_notification_owners AS owner
       INNER JOIN dm ON dm.id = owner.dm_id`;
  const created = input.actors ? "actor.created_at" : "owner.created_at";
  const rowId = input.actors ? "actor.record_id" : "owner.dm_id";
  return input.source.prepare(`
    SELECT ${select}
    FROM ${from}
    WHERE dm.channel_id IN (?, ?)
      AND (
        ? = '' OR COALESCE(${created}, '') > ?
        OR (COALESCE(${created}, '') = ? AND ${rowId} > ?)
      )
    ORDER BY COALESCE(${created}, '') ASC, ${rowId} ASC
    LIMIT ?
  `).bind(
    input.channelId,
    `${input.channelId}_live`,
    cursorCreatedAt,
    cursorCreatedAt,
    cursorCreatedAt,
    cursorId,
    DM_DELTA_BATCH_SIZE + 1,
  ).all<DependentRow>();
}

async function copyDependentBatch(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
  destination: D1Database;
  job: DmDeltaJobRow;
  actors: boolean;
  nextStage: CopyStage;
}) {
  const blocker = await sourceBlocker({
    source: input.env.DB,
    channelId: input.channelId,
    expectedVersion: input.job.source_projection_version,
  });
  if (blocker) {
    await markFailed(input.destination, input.channelId);
    return response({
      ...input,
      stage: input.job.stage,
      status: "failed",
      idempotent: false,
      blockers: [blocker],
    });
  }
  const rows = await readDependentRows({
    source: input.env.DB,
    channelId: input.channelId,
    actors: input.actors,
    cursorCreatedAt: input.job.cursor_created_at,
    cursorId: input.job.cursor_row_id,
  });
  const batchRows = rows.results.slice(0, DM_DELTA_BATCH_SIZE);
  const hasMore = rows.results.length > DM_DELTA_BATCH_SIZE;
  const last = batchRows.at(-1);
  const statements = batchRows.map((row) => input.actors
    ? input.destination.prepare(`
        INSERT INTO message_actor_identities (
          record_id, record_type, channel_id, uid, device_id_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(record_id, record_type) DO UPDATE SET
          channel_id = excluded.channel_id, uid = excluded.uid,
          device_id_hash = excluded.device_id_hash, created_at = excluded.created_at
      `).bind(
        row.record_id, row.record_type, row.channel_id, row.uid,
        row.device_id_hash, row.created_at,
      )
    : input.destination.prepare(`
        INSERT INTO dm_notification_owners (dm_id, channel_id, user_id, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(dm_id) DO UPDATE SET
          channel_id = excluded.channel_id, user_id = excluded.user_id,
          created_at = excluded.created_at
      `).bind(row.dm_id, row.channel_id, row.user_id, row.created_at));
  statements.push(input.destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET stage = ?, cursor_created_at = ?, cursor_row_id = ?,
      stage_rows_copied = ?, updated_at = ?
    WHERE channel_id = ? AND source_projection_version = ?
      AND stage = ? AND status = 'active'
      AND COALESCE(cursor_created_at, '') = ?
      AND COALESCE(cursor_row_id, '') = ?
  `).bind(
    hasMore ? input.job.stage : input.nextStage,
    hasMore ? last?.__cursor_created_at || null : null,
    hasMore ? last?.__cursor_row_id || null : null,
    hasMore ? Number(input.job.stage_rows_copied) + batchRows.length : 0,
    new Date().toISOString(),
    input.channelId,
    input.job.source_projection_version,
    input.job.stage,
    input.job.cursor_created_at || "",
    input.job.cursor_row_id || "",
  ));
  const results = await input.destination.batch(statements);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    throw new Error("canary_dm_dependent_job_not_advanced");
  }
  return response({
    ...input,
    stage: hasMore ? input.job.stage : input.nextStage,
    status: "active",
    idempotent: false,
    batchRowsCopied: batchRows.length,
    stageRowsCopied: Number(input.job.stage_rows_copied) + batchRows.length,
    hasMore,
  });
}

export async function reconcileCanaryDmDeltaBatch(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const destination = resolveCanaryProjectionSource(input.env, input.shardId).database;
  const job = await readJob(destination, input.channelId);
  if (!job) throw new Error("canary_dm_job_missing");
  if (job.status !== "active") {
    return response({ ...input, ...job, idempotent: true, blockers: ["copy_job_not_active"] });
  }
  if (job.stage === "delta_dm_roots_upserting") {
    return copyCanonicalBatch({
      ...input, destination, job, table: "dm", recordType: "dm",
      columns: CANARY_DM_COPY_COLUMNS, nextStage: "delta_dm_replies_upserting",
    });
  }
  if (job.stage === "delta_dm_replies_upserting") {
    return copyCanonicalBatch({
      ...input, destination, job, table: "dm_replies", recordType: "dm_reply",
      columns: CANARY_DM_REPLY_COPY_COLUMNS, nextStage: "delta_dm_replies_pruning",
    });
  }
  if (job.stage === "delta_dm_replies_pruning") {
    return pruneBatch({
      ...input, destination, job, table: "dm_replies", recordType: "dm_reply",
      nextStage: "delta_dm_roots_pruning",
    });
  }
  if (job.stage === "delta_dm_roots_pruning") {
    return pruneBatch({
      ...input, destination, job, table: "dm", recordType: "dm",
      nextStage: "delta_dm_actors_copying",
    });
  }
  if (job.stage === "delta_dm_actors_copying") {
    return copyDependentBatch({
      ...input, destination, job, actors: true,
      nextStage: "delta_dm_notification_owners_copying",
    });
  }
  if (job.stage === "delta_dm_notification_owners_copying") {
    return copyDependentBatch({
      ...input, destination, job, actors: false, nextStage: "delta_dm_dependents_copied",
    });
  }
  return response({
    ...input,
    ...job,
    idempotent: true,
    blockers: isCanaryDmDeltaStage(job.stage) ? [] : ["dm_delta_stage_required"],
    hasMore: false,
  });
}

async function readVerificationCounts(database: D1Database, channelId: string) {
  return database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM dm WHERE channel_id IN (?, ?)) AS dm_count,
      (SELECT COUNT(*) FROM dm_replies WHERE channel_id IN (?, ?)) AS reply_count,
      (SELECT COUNT(*) FROM message_actor_identities AS actor
        INNER JOIN dm ON dm.id = actor.record_id AND actor.record_type = 'dm'
        WHERE dm.channel_id IN (?, ?)) AS actor_count,
      (SELECT COUNT(*) FROM dm_notification_owners AS owner
        INNER JOIN dm ON dm.id = owner.dm_id
        WHERE dm.channel_id IN (?, ?)) AS notification_owner_count,
      (SELECT COUNT(*) FROM dm_replies AS reply
        LEFT JOIN dm ON dm.id = reply.dm_id
        WHERE reply.channel_id IN (?, ?) AND dm.id IS NULL) AS orphan_reply_count,
      (SELECT COUNT(*) FROM message_actor_identities AS actor
        LEFT JOIN dm ON dm.id = actor.record_id
        WHERE actor.record_type = 'dm' AND actor.channel_id IN (?, ?) AND dm.id IS NULL)
        AS orphan_actor_count,
      (SELECT COUNT(*) FROM dm_notification_owners AS owner
        LEFT JOIN dm ON dm.id = owner.dm_id
        WHERE owner.channel_id IN (?, ?) AND dm.id IS NULL)
        AS orphan_notification_owner_count,
      (SELECT COUNT(*) FROM dm AS root
        WHERE root.channel_id IN (?, ?)
          AND COALESCE(root.activity_at, '') != COALESCE((
            SELECT MAX(value) FROM (
              SELECT root.created_at AS value
              UNION ALL
              SELECT reply.created_at AS value
              FROM dm_replies AS reply WHERE reply.dm_id = root.id
            )
          ), '')) AS activity_mismatch_count
  `).bind(
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
    channelId, `${channelId}_live`,
  ).first<DmVerificationCounts>();
}

export async function completeCanaryDmDelta(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const destination = resolveCanaryProjectionSource(input.env, input.shardId).database;
  const job = await readJob(destination, input.channelId);
  if (!job) throw new Error("canary_dm_job_missing");
  if (job.status === "active" && job.stage === "delta_dm_verified") {
    return response({ ...input, ...job, idempotent: true });
  }
  if (job.status !== "active" || job.stage !== "delta_dm_dependents_copied") {
    return response({ ...input, ...job, idempotent: false, blockers: ["dm_delta_incomplete"] });
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
    readVerificationCounts(input.env.DB, input.channelId),
    readVerificationCounts(destination, input.channelId),
  ]);
  if (!sourceCounts || !destinationCounts) throw new Error("canary_dm_verification_missing");
  const blockers: string[] = [];
  for (const key of ["dm_count", "reply_count", "actor_count", "notification_owner_count"] as const) {
    if (Number(sourceCounts[key]) !== Number(destinationCounts[key])) {
      blockers.push(`dm_${key}_mismatch`);
    }
  }
  if (Number(destinationCounts.orphan_reply_count) !== 0) blockers.push("dm_reply_orphan");
  if (Number(destinationCounts.orphan_actor_count) !== 0) blockers.push("dm_actor_orphan");
  if (Number(destinationCounts.orphan_notification_owner_count) !== 0) {
    blockers.push("dm_notification_owner_orphan");
  }
  if (Number(destinationCounts.activity_mismatch_count) !== 0) blockers.push("dm_activity_mismatch");
  if (blockers.length > 0) {
    return response({ ...input, ...job, idempotent: false, blockers });
  }
  const results = await destination.batch([
    destination.prepare(`
      DELETE FROM canary_dm_reconciliation_seen WHERE channel_id = ?
    `).bind(input.channelId),
    destination.prepare(`
      UPDATE canary_channel_copy_jobs
      SET stage = 'delta_dm_verified', updated_at = ?
      WHERE channel_id = ? AND source_projection_version = ?
        AND stage = 'delta_dm_dependents_copied' AND status = 'active'
    `).bind(new Date().toISOString(), input.channelId, job.source_projection_version),
  ]);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    throw new Error("canary_dm_job_not_completed");
  }
  return response({ ...input, stage: "delta_dm_verified", status: "active", idempotent: false });
}
