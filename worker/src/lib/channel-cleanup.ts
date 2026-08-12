import type { Env } from "../types";
import { invalidatePasscodeAttempts } from "../routes/passcode";
import { getCleanupRetryDelayMs, parseCleanupMediaKeys } from "./cleanup-policy";
import { extractMediaKey } from "./media";
import { recordOperationalEvent } from "./operational-events";
import { invalidateBannedWordsCache, invalidatePasscodeCache } from "./validation";

const CLEANUP_LEASE_MS = 5 * 60 * 1000;
const R2_DELETE_BATCH_SIZE = 1000;

interface CleanupJobRow {
  id: string;
  resource_id: string;
  media_keys_json: string;
  realtime_completed_at: string | null;
  media_completed_at: string | null;
  attempt_count: number;
}

export interface ChannelDeletionResult {
  cleanupJobId: string;
  cleanupPending: boolean;
}

export interface CleanupRetrySummary {
  attempted: number;
  completed: number;
  pending: number;
}

function collectMediaKeys(sources: unknown[], ticketKeys: unknown[]): string[] {
  const mediaKeys = new Set<string>();
  for (const source of sources) {
    if (typeof source !== "string") continue;
    for (const match of source.matchAll(/\/api\/media\/([^"'\\\s)<>]+)/g)) {
      const key = extractMediaKey(`/api/media/${match[1]}`);
      if (key) mediaKeys.add(key);
    }
  }
  for (const key of ticketKeys) {
    if (typeof key === "string" && key) mediaKeys.add(key);
  }
  return [...mediaKeys];
}

async function recordCleanupFailure(
  env: Env,
  job: CleanupJobRow,
  errors: string[],
): Promise<void> {
  try {
    await recordOperationalEvent({
      env,
      severity: "warn",
      route: "channel cleanup",
      eventType: "cleanup_failed",
      targetId: job.resource_id,
      detail: {
        cleanup_job_id: job.id,
        attempt_count: job.attempt_count,
        incomplete_stages: [
          ...(!job.realtime_completed_at ? ["realtime"] : []),
          ...(!job.media_completed_at ? ["media"] : []),
        ],
        errors,
      },
    });
  } catch (error) {
    console.warn("failed to record channel cleanup failure", job.id, error);
  }
}

async function processChannelCleanupJob(
  env: Env,
  jobId: string,
  nowMs = Date.now(),
): Promise<"completed" | "pending" | "not_due"> {
  const now = new Date(nowMs).toISOString();
  const leaseUntil = new Date(nowMs + CLEANUP_LEASE_MS).toISOString();
  const claimed = await env.DB.prepare(`
    UPDATE cleanup_jobs
    SET attempt_count = attempt_count + 1,
        next_attempt_at = ?,
        updated_at = ?
    WHERE id = ?
      AND completed_at IS NULL
      AND next_attempt_at <= ?
  `).bind(leaseUntil, now, jobId, now).run();
  if (!claimed.meta.changes) return "not_due";

  const job = await env.DB.prepare(`
    SELECT id, resource_id, media_keys_json, realtime_completed_at,
           media_completed_at, attempt_count
    FROM cleanup_jobs
    WHERE id = ?
  `).bind(jobId).first<CleanupJobRow>();
  if (!job) return "not_due";

  let realtimeCompleted = Boolean(job.realtime_completed_at);
  let mediaCompleted = Boolean(job.media_completed_at);
  const errors: string[] = [];

  if (!realtimeCompleted) {
    try {
      const doId = env.CHAT_ROOM.idFromName(job.resource_id);
      const response = await env.CHAT_ROOM.get(doId).fetch(new Request(
        "http://internal/channel-deleted",
        { method: "POST" },
      ));
      if (!response.ok) {
        throw new Error(`Durable Object returned ${response.status}`);
      }
      await env.DB.prepare(`
        UPDATE cleanup_jobs
        SET realtime_completed_at = ?, updated_at = ?
        WHERE id = ? AND realtime_completed_at IS NULL
      `).bind(now, now, job.id).run();
      realtimeCompleted = true;
    } catch (error) {
      errors.push(`realtime: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!mediaCompleted) {
    try {
      const mediaKeys = parseCleanupMediaKeys(job.media_keys_json);
      for (let index = 0; index < mediaKeys.length; index += R2_DELETE_BATCH_SIZE) {
        await env.MEDIA.delete(mediaKeys.slice(index, index + R2_DELETE_BATCH_SIZE));
      }
      await env.DB.prepare(`
        UPDATE cleanup_jobs
        SET media_completed_at = ?, updated_at = ?
        WHERE id = ? AND media_completed_at IS NULL
      `).bind(now, now, job.id).run();
      mediaCompleted = true;
    } catch (error) {
      errors.push(`media: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (realtimeCompleted && mediaCompleted) {
    await env.DB.prepare(`
      UPDATE cleanup_jobs
      SET completed_at = ?, updated_at = ?, last_error = NULL
      WHERE id = ? AND completed_at IS NULL
    `).bind(now, now, job.id).run();
    if (job.attempt_count > 1) {
      try {
        await recordOperationalEvent({
          env,
          severity: "info",
          route: "channel cleanup",
          eventType: "cleanup_recovered",
          targetId: job.resource_id,
          detail: {
            cleanup_job_id: job.id,
            attempt_count: job.attempt_count,
          },
        });
      } catch (error) {
        console.warn("failed to record channel cleanup recovery", job.id, error);
      }
    }
    return "completed";
  }

  const nextAttemptAt = new Date(
    nowMs + getCleanupRetryDelayMs(job.attempt_count),
  ).toISOString();
  const lastError = errors.join("; ").slice(0, 2000) || "cleanup stage incomplete";
  await env.DB.prepare(`
    UPDATE cleanup_jobs
    SET next_attempt_at = ?, updated_at = ?, last_error = ?
    WHERE id = ? AND completed_at IS NULL
  `).bind(nextAttemptAt, now, lastError, job.id).run();
  await recordCleanupFailure(env, {
    ...job,
    realtime_completed_at: realtimeCompleted ? now : null,
    media_completed_at: mediaCompleted ? now : null,
  }, errors);
  return "pending";
}

export async function deleteChannel(
  channelId: string,
  env: Env,
): Promise<ChannelDeletionResult> {
  const channelIds = [channelId, `${channelId}_live`];
  const placeholders = channelIds.map(() => "?").join(", ");
  const [
    channel,
    messageMedia,
    galleryMedia,
    dmMedia,
    channelMedia,
    configMedia,
    uploadTickets,
  ] = await Promise.all([
    env.DB.prepare("SELECT instance_id FROM channels WHERE id = ?")
      .bind(channelId)
      .first<{ instance_id: string | null }>(),
    env.DB.prepare(`SELECT image FROM messages WHERE channel_id IN (${placeholders}) AND image IS NOT NULL`).bind(...channelIds).all(),
    env.DB.prepare(`SELECT image FROM gallery WHERE channel_id IN (${placeholders}) AND image IS NOT NULL`).bind(...channelIds).all(),
    env.DB.prepare(`SELECT image FROM dm WHERE channel_id IN (${placeholders}) AND image IS NOT NULL`).bind(...channelIds).all(),
    env.DB.prepare(`SELECT profile_image, background_image FROM channels WHERE id IN (${placeholders}) AND (profile_image IS NOT NULL OR background_image IS NOT NULL)`).bind(...channelIds).all(),
    env.DB.prepare(`SELECT text FROM config WHERE channel_id IN (${placeholders})`).bind(...channelIds).all(),
    env.DB.prepare(`SELECT key FROM upload_tickets WHERE channel_id IN (${placeholders})`).bind(...channelIds).all(),
  ]);
  if (!channel) {
    throw new Error(`channel not found for cleanup: ${channelId}`);
  }

  const mediaKeys = collectMediaKeys([
    ...messageMedia.results.map((row) => row.image),
    ...galleryMedia.results.map((row) => row.image),
    ...dmMedia.results.map((row) => row.image),
    ...channelMedia.results.map((row) => row.profile_image),
    ...channelMedia.results.map((row) => row.background_image),
    ...configMedia.results.map((row) => row.text),
  ], uploadTickets.results.map((row) => row.key));
  const cleanupJobId = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO cleanup_jobs (
        id, resource_type, resource_id, resource_version, media_keys_json,
        attempt_count, next_attempt_at, created_at, updated_at
      ) VALUES (?, 'channel', ?, ?, ?, 0, ?, ?, ?)
    `).bind(
      cleanupJobId,
      channelId,
      channel.instance_id || cleanupJobId,
      JSON.stringify(mediaKeys),
      now,
      now,
      now,
    ),
    env.DB.prepare(`DELETE FROM messages WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM message_links WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM gallery WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM dm WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM blocked WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM message_actor_identities WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM config WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM moderators WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM banned_words WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM upload_tickets WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM user_recent_channels WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM channels WHERE id IN (${placeholders})`).bind(...channelIds),
  ]);

  invalidatePasscodeCache(channelId);
  invalidateBannedWordsCache(channelId);
  invalidatePasscodeAttempts(channelId);

  try {
    const status = await processChannelCleanupJob(env, cleanupJobId);
    return {
      cleanupJobId,
      cleanupPending: status !== "completed",
    };
  } catch (error) {
    console.warn("immediate channel cleanup attempt failed", error);
    return { cleanupJobId, cleanupPending: true };
  }
}

export async function retryPendingChannelCleanups(
  env: Env,
  nowMs = Date.now(),
  limit = 20,
): Promise<CleanupRetrySummary> {
  const now = new Date(nowMs).toISOString();
  const { results } = await env.DB.prepare(`
    SELECT id
    FROM cleanup_jobs
    WHERE resource_type = 'channel'
      AND completed_at IS NULL
      AND next_attempt_at <= ?
    ORDER BY next_attempt_at ASC
    LIMIT ?
  `).bind(now, limit).all<{ id: string }>();

  let completed = 0;
  let pending = 0;
  for (const row of results || []) {
    try {
      const status = await processChannelCleanupJob(env, row.id, nowMs);
      if (status === "completed") completed++;
      if (status === "pending") pending++;
    } catch (error) {
      pending++;
      console.warn("scheduled channel cleanup attempt failed", row.id, error);
    }
  }
  return {
    attempted: (results || []).length,
    completed,
    pending,
  };
}

export async function deleteCompletedCleanupJobs(
  env: Env,
  cutoff: string,
  limit = 250,
): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT rowid
    FROM cleanup_jobs
    WHERE completed_at IS NOT NULL AND completed_at < ?
    ORDER BY completed_at ASC
    LIMIT ?
  `).bind(cutoff, limit).all<{ rowid: number }>();
  const rowIds = (results || []).map((row) => row.rowid);
  if (rowIds.length === 0) return 0;
  const placeholders = rowIds.map(() => "?").join(", ");
  await env.DB.prepare(`DELETE FROM cleanup_jobs WHERE rowid IN (${placeholders})`)
    .bind(...rowIds)
    .run();
  return rowIds.length;
}
