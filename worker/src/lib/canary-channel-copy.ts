import type { Env } from "../types.ts";
import {
  type CanaryShardId,
  resolveCanaryProjectionSource,
} from "./channel-projection-dispatcher.ts";
import { preflightCanaryChannelCopy } from "./canary-channel-copy-preflight.ts";

type CopyStage = "prepared" | "channels_copied";
type CopyStatus = "active" | "failed" | "complete";

interface CopyJobRow {
  channel_id: string;
  source_projection_version: number;
  stage: CopyStage;
  status: CopyStatus;
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
}

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
    SELECT channel_id, source_projection_version, stage, status
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
      SELECT channel_id, source_projection_version, stage, status
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
  if (job.stage === "channels_copied") {
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
