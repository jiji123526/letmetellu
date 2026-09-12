import type { Env } from "../types.ts";
import {
  type CanaryShardId,
  resolveCanaryProjectionSource,
} from "./channel-projection-dispatcher.ts";
import { preflightCanaryChannelCopy } from "./canary-channel-copy-preflight.ts";

export type CopyStage =
  | "prepared"
  | "channels_copied"
  | "moderators_copied"
  | "blocked_copied"
  | "banned_words_copied"
  | "channel_moderation_copied"
  | "channel_petitions_copied"
  | "config_copied"
  | "upload_tickets_copied";
type CopyStatus = "active" | "failed" | "complete";

export const CANARY_POLICY_COPY_BATCH_SIZE = 100;

interface CopyJobRow {
  channel_id: string;
  source_projection_version: number;
  stage: CopyStage;
  status: CopyStatus;
  cursor_channel_id: string | null;
  cursor_row_id: string | null;
  stage_rows_copied: number;
}

interface CanonicalChannelRow {
  id: string;
  owner_uid: string;
  name: string;
  profile_image: string | null;
  bubble_color: string | null;
  passcode: string | null;
  notice: string | null;
  is_frozen: number | null;
  created_at: string | null;
  passcode_hint: string | null;
  instance_id: string | null;
  show_on_profile: number;
  background_type: string;
  background_color: string | null;
  background_image: string | null;
  background_overlay: number;
  background_blur: number;
  projection_source_version: number;
}

export interface CanaryChannelCopyResult {
  shardId: CanaryShardId;
  channelId: string;
  stage: CopyStage;
  status: CopyStatus;
  idempotent: boolean;
  blockers: string[];
  batchRowsCopied?: number;
  stageRowsCopied?: number;
  hasMore?: boolean;
}

interface PolicyCopyRow extends Record<string, unknown> {
  __cursor_channel_id: string;
  __cursor_row_id: string;
}

interface PolicyCopyStep {
  fromStage: CopyStage;
  completedStage: CopyStage;
  table: string;
  keyColumn: string;
  columns: readonly string[];
}

const POLICY_COPY_STEPS: readonly PolicyCopyStep[] = [
  {
    fromStage: "channels_copied",
    completedStage: "moderators_copied",
    table: "moderators",
    keyColumn: "uid",
    columns: ["channel_id", "uid", "role", "created_at"],
  },
  {
    fromStage: "moderators_copied",
    completedStage: "blocked_copied",
    table: "blocked",
    keyColumn: "id",
    columns: [
      "id", "uid", "reason", "fingerprint", "channel_id", "created_at",
      "device_id",
    ],
  },
  {
    fromStage: "blocked_copied",
    completedStage: "banned_words_copied",
    table: "banned_words",
    keyColumn: "id",
    columns: ["id", "word", "channel_id", "expires", "created_at"],
  },
  {
    fromStage: "banned_words_copied",
    completedStage: "channel_moderation_copied",
    table: "channel_moderation",
    keyColumn: "channel_id",
    columns: [
      "channel_id", "status", "warning_sent_at", "warned_report_count",
      "suspension_notice_sent_at", "suspension_reason", "frozen_at",
      "frozen_by", "petition_status", "current_petition_id", "updated_at",
    ],
  },
  {
    fromStage: "channel_moderation_copied",
    completedStage: "channel_petitions_copied",
    table: "channel_petitions",
    keyColumn: "id",
    columns: [
      "id", "channel_id", "owner_uid", "text", "status", "created_at",
      "resolved_at", "resolved_by", "resolution_note", "inbox_message_id",
    ],
  },
  {
    fromStage: "channel_petitions_copied",
    completedStage: "config_copied",
    table: "config",
    keyColumn: "id",
    columns: ["id", "text", "channel_id", "updated_at"],
  },
  {
    fromStage: "config_copied",
    completedStage: "upload_tickets_copied",
    table: "upload_tickets",
    keyColumn: "id",
    columns: [
      "id", "key", "channel_id", "uid", "auth_uid", "purpose", "ip_hash",
      "status", "attached_record_id", "attached_record_type", "created_at",
      "expires_at",
    ],
  },
] as const;

function result(
  shardId: CanaryShardId,
  channelId: string,
  job: Pick<CopyJobRow, "stage" | "status">,
  idempotent: boolean,
  blockers: string[] = [],
): CanaryChannelCopyResult {
  return {
    shardId,
    channelId,
    stage: job.stage,
    status: job.status,
    idempotent,
    blockers,
  };
}

export async function startCanaryChannelCopy(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const preflight = await preflightCanaryChannelCopy(input);
  if (preflight.blockers.length > 0) {
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: "prepared",
      status: "failed",
      idempotent: false,
      blockers: preflight.blockers,
    };
  }

  const destination = resolveCanaryProjectionSource(
    input.env,
    input.shardId,
  ).database;
  const now = new Date().toISOString();
  const createResult = await destination.prepare(`
    INSERT INTO canary_channel_copy_jobs (
      channel_id,
      source_projection_version,
      stage,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, 'prepared', 'active', ?, ?)
    ON CONFLICT(channel_id) DO NOTHING
  `).bind(
    input.channelId,
    preflight.projectionSourceVersion,
    now,
    now,
  ).run();
  const job = await destination.prepare(`
    SELECT
      channel_id,
      source_projection_version,
      stage,
      status,
      cursor_channel_id,
      cursor_row_id,
      stage_rows_copied
    FROM canary_channel_copy_jobs
    WHERE channel_id = ?
  `).bind(input.channelId).first<CopyJobRow>();
  if (!job) throw new Error("canary_copy_job_missing");
  if (
    Number(job.source_projection_version) !== preflight.projectionSourceVersion
    || job.status !== "active"
  ) {
    return result(input.shardId, input.channelId, job, true, [
      "copy_job_conflict",
    ]);
  }
  return result(
    input.shardId,
    input.channelId,
    job,
    Number(createResult.meta.changes || 0) === 0,
  );
}

function channelInsert(
  destination: D1Database,
  row: CanonicalChannelRow,
): D1PreparedStatement {
  return destination.prepare(`
    INSERT INTO channels (
      id,
      owner_uid,
      name,
      profile_image,
      bubble_color,
      passcode,
      notice,
      is_frozen,
      created_at,
      passcode_hint,
      instance_id,
      show_on_profile,
      background_type,
      background_color,
      background_image,
      background_overlay,
      background_blur,
      projection_source_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    row.id,
    row.owner_uid,
    row.name,
    row.profile_image,
    row.bubble_color,
    row.passcode,
    row.notice,
    row.is_frozen,
    row.created_at,
    row.passcode_hint,
    row.instance_id,
    row.show_on_profile,
    row.background_type,
    row.background_color,
    row.background_image,
    row.background_overlay,
    row.background_blur,
    row.projection_source_version,
  );
}

export async function copyCanaryCanonicalChannels(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const destination = resolveCanaryProjectionSource(
    input.env,
    input.shardId,
  ).database;
  const [job, sourceRowsResult] = await Promise.all([
    destination.prepare(`
      SELECT
        channel_id,
        source_projection_version,
        stage,
        status,
        cursor_channel_id,
        cursor_row_id,
        stage_rows_copied
      FROM canary_channel_copy_jobs
      WHERE channel_id = ?
    `).bind(input.channelId).first<CopyJobRow>(),
    input.env.DB.prepare(`
      SELECT
        id,
        owner_uid,
        name,
        profile_image,
        bubble_color,
        passcode,
        notice,
        is_frozen,
        created_at,
        passcode_hint,
        instance_id,
        show_on_profile,
        background_type,
        background_color,
        background_image,
        background_overlay,
        background_blur,
        projection_source_version
      FROM channels
      WHERE id IN (?, ?)
      ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
    `).bind(
      input.channelId,
      `${input.channelId}_live`,
      input.channelId,
    ).all<CanonicalChannelRow>(),
  ]);
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
    return result(input.shardId, input.channelId, job, true, [
      "copy_job_not_active",
    ]);
  }
  if (job.stage !== "prepared") {
    return result(input.shardId, input.channelId, job, true);
  }

  const sourceRows = sourceRowsResult.results;
  const parent = sourceRows.find((row) => row.id === input.channelId);
  if (
    !parent
    || Number(parent.projection_source_version)
      !== Number(job.source_projection_version)
    || sourceRows.some((row) => (
      row.id !== input.channelId && row.id !== `${input.channelId}_live`
    ))
  ) {
    return result(input.shardId, input.channelId, job, false, [
      "source_version_changed",
    ]);
  }

  const now = new Date().toISOString();
  await destination.batch([
    ...sourceRows.map((row) => channelInsert(destination, row)),
    destination.prepare(`
      UPDATE canary_channel_copy_jobs
      SET stage = 'channels_copied',
          updated_at = ?
      WHERE channel_id = ?
        AND source_projection_version = ?
        AND stage = 'prepared'
        AND status = 'active'
    `).bind(now, input.channelId, job.source_projection_version),
  ]);

  const currentSource = await input.env.DB.prepare(`
    SELECT projection_source_version
    FROM channels
    WHERE id = ?
  `).bind(input.channelId).first<{ projection_source_version: number }>();
  if (
    !currentSource
    || Number(currentSource.projection_source_version)
      !== Number(job.source_projection_version)
  ) {
    await destination.prepare(`
      UPDATE canary_channel_copy_jobs
      SET status = 'failed',
          updated_at = ?
      WHERE channel_id = ?
    `).bind(new Date().toISOString(), input.channelId).run();
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: "channels_copied",
      status: "failed",
      idempotent: false,
      blockers: ["source_version_changed"],
    };
  }

  return {
    shardId: input.shardId,
    channelId: input.channelId,
    stage: "channels_copied",
    status: "active",
    idempotent: false,
    blockers: [],
  };
}

function policyStepFor(stage: CopyStage): PolicyCopyStep | null {
  return POLICY_COPY_STEPS.find((step) => step.fromStage === stage) || null;
}

function readPolicyRows(input: {
  database: D1Database;
  channelId: string;
  step: PolicyCopyStep;
  cursorChannelId: string | null;
  cursorRowId: string | null;
}) {
  const cursorChannelId = input.cursorChannelId || "";
  const cursorRowId = input.cursorRowId || "";
  return input.database.prepare(`
    SELECT
      ${input.step.columns.join(", ")},
      channel_id AS __cursor_channel_id,
      ${input.step.keyColumn} AS __cursor_row_id
    FROM ${input.step.table}
    WHERE channel_id IN (?, ?)
      AND (
        ? = ''
        OR channel_id > ?
        OR (channel_id = ? AND ${input.step.keyColumn} > ?)
      )
    ORDER BY channel_id ASC, ${input.step.keyColumn} ASC
    LIMIT ?
  `).bind(
    input.channelId,
    `${input.channelId}_live`,
    cursorChannelId,
    cursorChannelId,
    cursorChannelId,
    cursorRowId,
    CANARY_POLICY_COPY_BATCH_SIZE + 1,
  ).all<PolicyCopyRow>();
}

function insertPolicyRow(
  destination: D1Database,
  step: PolicyCopyStep,
  row: PolicyCopyRow,
): D1PreparedStatement {
  return destination.prepare(`
    INSERT INTO ${step.table} (${step.columns.join(", ")})
    VALUES (${step.columns.map(() => "?").join(", ")})
  `).bind(...step.columns.map((column) => row[column] ?? null));
}

async function markCopyJobFailed(
  destination: D1Database,
  channelId: string,
): Promise<void> {
  await destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET status = 'failed',
        updated_at = ?
    WHERE channel_id = ?
      AND status = 'active'
  `).bind(new Date().toISOString(), channelId).run();
}

async function sourceVersionMatches(
  source: D1Database,
  channelId: string,
  expectedVersion: number,
): Promise<boolean> {
  const row = await source.prepare(`
    SELECT projection_source_version
    FROM channels
    WHERE id = ?
  `).bind(channelId).first<{ projection_source_version: number }>();
  return !!row
    && Number(row.projection_source_version) === Number(expectedVersion);
}

export async function copyCanaryPolicyConfigBatch(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
}): Promise<CanaryChannelCopyResult> {
  const destination = resolveCanaryProjectionSource(
    input.env,
    input.shardId,
  ).database;
  const job = await destination.prepare(`
    SELECT
      channel_id,
      source_projection_version,
      stage,
      status,
      cursor_channel_id,
      cursor_row_id,
      stage_rows_copied
    FROM canary_channel_copy_jobs
    WHERE channel_id = ?
  `).bind(input.channelId).first<CopyJobRow>();
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
    return result(input.shardId, input.channelId, job, true, [
      "copy_job_not_active",
    ]);
  }
  if (job.stage === "prepared") {
    return result(input.shardId, input.channelId, job, true, [
      "canonical_stage_required",
    ]);
  }

  const step = policyStepFor(job.stage);
  if (!step) {
    return {
      ...result(input.shardId, input.channelId, job, true),
      batchRowsCopied: 0,
      stageRowsCopied: Number(job.stage_rows_copied || 0),
      hasMore: false,
    };
  }
  if (!await sourceVersionMatches(
    input.env.DB,
    input.channelId,
    job.source_projection_version,
  )) {
    await markCopyJobFailed(destination, input.channelId);
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: job.stage,
      status: "failed",
      idempotent: false,
      blockers: ["source_version_changed"],
    };
  }

  const sourceResult = await readPolicyRows({
    database: input.env.DB,
    channelId: input.channelId,
    step,
    cursorChannelId: job.cursor_channel_id,
    cursorRowId: job.cursor_row_id,
  });
  const batchRows = sourceResult.results.slice(
    0,
    CANARY_POLICY_COPY_BATCH_SIZE,
  );
  const hasMore = sourceResult.results.length > CANARY_POLICY_COPY_BATCH_SIZE;
  const lastRow = batchRows.at(-1);
  const completedStageRows = Number(job.stage_rows_copied || 0)
    + batchRows.length;
  const nextStage = hasMore ? job.stage : step.completedStage;
  const nextCursorChannelId = hasMore
    ? lastRow?.__cursor_channel_id || null
    : null;
  const nextCursorRowId = hasMore
    ? lastRow?.__cursor_row_id || null
    : null;
  const nextStageRows = hasMore ? completedStageRows : 0;
  const now = new Date().toISOString();
  const statements = [
    ...batchRows.map((row) => insertPolicyRow(destination, step, row)),
    destination.prepare(`
      UPDATE canary_channel_copy_jobs
      SET stage = ?,
          cursor_channel_id = ?,
          cursor_row_id = ?,
          stage_rows_copied = ?,
          updated_at = ?
      WHERE channel_id = ?
        AND source_projection_version = ?
        AND stage = ?
        AND status = 'active'
        AND COALESCE(cursor_channel_id, '') = ?
        AND COALESCE(cursor_row_id, '') = ?
    `).bind(
      nextStage,
      nextCursorChannelId,
      nextCursorRowId,
      nextStageRows,
      now,
      input.channelId,
      job.source_projection_version,
      job.stage,
      job.cursor_channel_id || "",
      job.cursor_row_id || "",
    ),
  ];
  const batchResult = await destination.batch(statements);
  const updateChanges = Number(batchResult.at(-1)?.meta?.changes || 0);
  if (updateChanges !== 1) {
    const currentJob = await destination.prepare(`
      SELECT
        channel_id,
        source_projection_version,
        stage,
        status,
        cursor_channel_id,
        cursor_row_id,
        stage_rows_copied
      FROM canary_channel_copy_jobs
      WHERE channel_id = ?
    `).bind(input.channelId).first<CopyJobRow>();
    if (!currentJob) {
      throw new Error("canary_copy_job_missing_after_batch");
    }
    return {
      ...result(input.shardId, input.channelId, currentJob, true, [
        "copy_job_advanced",
      ]),
      batchRowsCopied: 0,
      stageRowsCopied: Number(currentJob.stage_rows_copied || 0),
      hasMore: currentJob.stage === job.stage,
    };
  }

  if (!await sourceVersionMatches(
    input.env.DB,
    input.channelId,
    job.source_projection_version,
  )) {
    await markCopyJobFailed(destination, input.channelId);
    return {
      shardId: input.shardId,
      channelId: input.channelId,
      stage: nextStage,
      status: "failed",
      idempotent: false,
      blockers: ["source_version_changed"],
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
