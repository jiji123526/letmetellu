import type { Env } from "../types.ts";
import {
  type CanaryShardId,
  resolveCanaryProjectionSource,
} from "./channel-projection-dispatcher.ts";
import { parseCanaryChannelShadowAllowlist } from "./canary-channel-shadow.ts";

interface CleanupJobRow {
  channel_id: string;
  source_projection_version: number;
  stage: string;
  status: "active" | "failed" | "abandoned" | "complete";
}

interface CleanupSafetyRow {
  local_projection_rows: number;
  non_pending_event_rows: number;
  unsupported_rows: number;
}

interface CleanupAuditRow {
  source_projection_version: number;
}

export interface CanaryChannelCleanupResult {
  shardId: CanaryShardId;
  channelId: string;
  sourceProjectionVersion: number;
  status: "abandoned" | "cleaned";
  idempotent: boolean;
  blockers: string[];
}

async function readJob(
  destination: D1Database,
  channelId: string,
): Promise<CleanupJobRow | null> {
  return destination.prepare(`
    SELECT channel_id, source_projection_version, stage, status
    FROM canary_channel_copy_jobs
    WHERE channel_id = ?
  `).bind(channelId).first<CleanupJobRow>();
}

function result(input: {
  shardId: CanaryShardId;
  channelId: string;
  sourceProjectionVersion: number;
  status: "abandoned" | "cleaned";
  idempotent: boolean;
  blockers?: string[];
}): CanaryChannelCleanupResult {
  return { ...input, blockers: input.blockers || [] };
}

export async function abandonCanaryChannelCopy(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
  sourceProjectionVersion: number;
}): Promise<CanaryChannelCleanupResult> {
  const destination = resolveCanaryProjectionSource(
    input.env,
    input.shardId,
  ).database;
  const job = await readJob(destination, input.channelId);
  if (!job) {
    return result({
      ...input,
      status: "abandoned",
      idempotent: false,
      blockers: ["copy_job_missing"],
    });
  }
  if (Number(job.source_projection_version) !== input.sourceProjectionVersion) {
    return result({
      ...input,
      status: "abandoned",
      idempotent: false,
      blockers: ["source_version_mismatch"],
    });
  }
  if (job.status === "abandoned") {
    return result({ ...input, status: "abandoned", idempotent: true });
  }
  if (job.status !== "active") {
    return result({
      ...input,
      status: "abandoned",
      idempotent: false,
      blockers: ["copy_job_not_active"],
    });
  }

  const update = await destination.prepare(`
    UPDATE canary_channel_copy_jobs
    SET status = 'abandoned', updated_at = ?
    WHERE channel_id = ?
      AND source_projection_version = ?
      AND status = 'active'
  `).bind(
    new Date().toISOString(),
    input.channelId,
    input.sourceProjectionVersion,
  ).run();
  if (Number(update.meta.changes || 0) !== 1) {
    return result({
      ...input,
      status: "abandoned",
      idempotent: true,
      blockers: ["copy_job_advanced"],
    });
  }
  return result({ ...input, status: "abandoned", idempotent: false });
}

async function readSafetyState(
  destination: D1Database,
  channelId: string,
): Promise<CleanupSafetyRow> {
  const liveChannelId = `${channelId}_live`;
  const row = await destination.prepare(`
    SELECT
      (SELECT COUNT(*) FROM channel_control_projections
        WHERE channel_id = ?) AS local_projection_rows,
      (SELECT COUNT(*) FROM domain_events
        WHERE channel_id = ? AND status != 'pending') AS non_pending_event_rows,
      (
        (SELECT COUNT(*) FROM channel_reports WHERE channel_id IN (?, ?))
        + (SELECT COUNT(*) FROM pending_admin_deletions WHERE channel_id IN (?, ?))
        + (SELECT COUNT(*) FROM notification_preferences WHERE channel_id IN (?, ?))
        + (SELECT COUNT(*) FROM notification_outbox WHERE channel_id IN (?, ?))
        + (SELECT COUNT(*) FROM user_recent_channels WHERE channel_id IN (?, ?))
        + (SELECT COUNT(*) FROM cleanup_jobs
            WHERE resource_type = 'channel' AND resource_id IN (?, ?))
      ) AS unsupported_rows
  `).bind(
    channelId,
    channelId,
    channelId, liveChannelId,
    channelId, liveChannelId,
    channelId, liveChannelId,
    channelId, liveChannelId,
    channelId, liveChannelId,
    channelId, liveChannelId,
  ).first<CleanupSafetyRow>();
  if (!row) throw new Error("canary_cleanup_safety_missing");
  return row;
}

export async function cleanupCanaryChannelCopy(input: {
  env: Env;
  shardId: CanaryShardId;
  channelId: string;
  sourceProjectionVersion: number;
}): Promise<CanaryChannelCleanupResult> {
  const destination = resolveCanaryProjectionSource(
    input.env,
    input.shardId,
  ).database;
  const shadowAllowlist = parseCanaryChannelShadowAllowlist(
    input.env.D1_CANARY_SHADOW_CHANNELS,
  );
  if (shadowAllowlist === null) {
    return result({
      ...input,
      status: "cleaned",
      idempotent: false,
      blockers: ["shadow_configuration_invalid"],
    });
  }
  if (shadowAllowlist.some((placement) => (
    placement.channelId === input.channelId
  ))) {
    return result({
      ...input,
      status: "cleaned",
      idempotent: false,
      blockers: ["channel_shadow_active"],
    });
  }

  const job = await readJob(destination, input.channelId);
  if (!job) {
    const audit = await destination.prepare(`
      SELECT source_projection_version
      FROM canary_channel_cleanup_audit
      WHERE channel_id = ?
      ORDER BY cleaned_at DESC, id DESC
      LIMIT 1
    `).bind(input.channelId).first<CleanupAuditRow>();
    if (Number(audit?.source_projection_version) === input.sourceProjectionVersion) {
      return result({ ...input, status: "cleaned", idempotent: true });
    }
    return result({
      ...input,
      status: "cleaned",
      idempotent: false,
      blockers: ["copy_job_missing"],
    });
  }
  if (Number(job.source_projection_version) !== input.sourceProjectionVersion) {
    return result({
      ...input,
      status: "cleaned",
      idempotent: false,
      blockers: ["source_version_mismatch"],
    });
  }
  if (job.status !== "failed" && job.status !== "abandoned") {
    return result({
      ...input,
      status: "cleaned",
      idempotent: false,
      blockers: ["cleanup_requires_failed_or_abandoned_job"],
    });
  }

  const safety = await readSafetyState(destination, input.channelId);
  const blockers: string[] = [];
  if (Number(safety.local_projection_rows) !== 0) {
    blockers.push("local_control_projection_present");
  }
  if (Number(safety.non_pending_event_rows) !== 0) {
    blockers.push("projection_event_already_processed");
  }
  if (Number(safety.unsupported_rows) !== 0) {
    blockers.push("unsupported_channel_state_present");
  }
  if (blockers.length > 0) {
    return result({
      ...input,
      status: "cleaned",
      idempotent: false,
      blockers,
    });
  }

  const liveChannelId = `${input.channelId}_live`;
  const now = new Date().toISOString();
  const statements = [
    destination.prepare("DELETE FROM canary_message_reconciliation_seen WHERE channel_id = ?")
      .bind(input.channelId),
    destination.prepare("DELETE FROM canary_dm_reconciliation_seen WHERE channel_id = ?")
      .bind(input.channelId),
    destination.prepare("DELETE FROM canary_notification_reconciliation_seen WHERE channel_id = ?")
      .bind(input.channelId),
    destination.prepare("DELETE FROM message_actor_identities WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM message_notification_owners WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM dm_notification_owners WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM dm_replies WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM dm WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM message_links WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM gallery WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM messages WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM upload_tickets WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM config WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM channel_petitions WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM channel_moderation WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM banned_words WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM blocked WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM moderators WHERE channel_id IN (?, ?)")
      .bind(input.channelId, liveChannelId),
    destination.prepare("DELETE FROM channels WHERE id = ?")
      .bind(liveChannelId),
    destination.prepare("DELETE FROM channels WHERE id = ?")
      .bind(input.channelId),
    destination.prepare("DELETE FROM domain_events WHERE channel_id = ?")
      .bind(input.channelId),
    destination.prepare("DELETE FROM channel_projection_versions WHERE channel_id = ?")
      .bind(input.channelId),
    destination.prepare(`
      INSERT INTO canary_channel_cleanup_audit (
        id,
        channel_id,
        source_projection_version,
        previous_stage,
        previous_status,
        cleaned_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.channelId,
      input.sourceProjectionVersion,
      job.stage,
      job.status,
      now,
    ),
    destination.prepare(`
      DELETE FROM canary_channel_copy_jobs
      WHERE channel_id = ?
        AND source_projection_version = ?
        AND status IN ('failed', 'abandoned')
    `).bind(input.channelId, input.sourceProjectionVersion),
  ];
  const results = await destination.batch(statements);
  if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
    throw new Error("canary_cleanup_job_not_deleted");
  }
  return result({ ...input, status: "cleaned", idempotent: false });
}
