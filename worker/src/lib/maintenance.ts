import type { Env } from "../types";
import { deleteCompletedCleanupJobs, retryPendingChannelCleanups } from "./channel-cleanup";
import { endLiveSession, isLiveSessionExpired, parseLiveSessionState } from "./live-sessions";
import { cleanupExpiredUploadTickets } from "./upload-tickets";
import { finalizeExpiredAdminDeletions } from "./pending-admin-deletions";

const DAY_MS = 24 * 60 * 60 * 1000;
const DURABLE_RATE_LIMIT_RETENTION_MS = 7 * DAY_MS;
const OPERATIONAL_EVENTS_RETENTION_MS = 30 * DAY_MS;
const MODERATION_AUDIT_RETENTION_MS = 365 * DAY_MS;
const SUPPORT_AUDIT_RETENTION_MS = 365 * DAY_MS;
const MESSAGE_ACTOR_IDENTITY_RETENTION_MS = 90 * DAY_MS;
const COMPLETED_CLEANUP_JOB_RETENTION_MS = 30 * DAY_MS;
const CLEANUP_BATCH_LIMIT = 250;
const CLEANUP_MAX_BATCHES = 8;
const LIVE_SESSION_EXPIRY_BATCH_LIMIT = 20;
const CHANNEL_CLEANUP_RETRY_LIMIT = 20;

function cutoffIso(retentionMs: number, nowMs: number): string {
  return new Date(nowMs - retentionMs).toISOString();
}

async function deleteRowsByRowId(
  env: Env,
  table: "durable_rate_limits" | "operational_events" | "moderation_audit_logs" | "message_actor_identities" | "support_audit_logs",
  timestampColumn: "updated_at" | "created_at",
  cutoff: string,
  limit: number,
): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT rowid FROM ${table} WHERE ${timestampColumn} < ? ORDER BY ${timestampColumn} ASC LIMIT ?`
  ).bind(cutoff, limit).all<{ rowid: number }>();

  const rowIds = (results || []).map((row) => row.rowid);
  if (rowIds.length === 0) return 0;

  const placeholders = rowIds.map(() => "?").join(", ");
  await env.DB.prepare(`DELETE FROM ${table} WHERE rowid IN (${placeholders})`)
    .bind(...rowIds)
    .run();
  return rowIds.length;
}

async function drainTableRetention(
  env: Env,
  table: "durable_rate_limits" | "operational_events" | "moderation_audit_logs" | "message_actor_identities" | "support_audit_logs",
  timestampColumn: "updated_at" | "created_at",
  cutoff: string,
): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch++) {
    const count = await deleteRowsByRowId(env, table, timestampColumn, cutoff, CLEANUP_BATCH_LIMIT);
    deleted += count;
    if (count < CLEANUP_BATCH_LIMIT) break;
  }
  return deleted;
}

async function drainExpiredUploadTicketRetention(env: Env): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch++) {
    const count = await cleanupExpiredUploadTickets(env, CLEANUP_BATCH_LIMIT);
    deleted += count;
    if (count < CLEANUP_BATCH_LIMIT) break;
  }
  return deleted;
}

async function drainCompletedCleanupJobRetention(env: Env, cutoff: string): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch++) {
    const count = await deleteCompletedCleanupJobs(env, cutoff, CLEANUP_BATCH_LIMIT);
    deleted += count;
    if (count < CLEANUP_BATCH_LIMIT) break;
  }
  return deleted;
}

async function expireTimedOutLiveSessions(env: Env, nowMs: number): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id, channel_id, text, updated_at FROM config WHERE id GLOB 'live_*' AND text IS NOT NULL AND text != 'false' ORDER BY updated_at ASC LIMIT ?"
  ).bind(LIVE_SESSION_EXPIRY_BATCH_LIMIT).all<{ id: string; channel_id: string; text: string; updated_at: string | null }>();

  let expiredCount = 0;
  for (const row of results || []) {
    const liveSession = parseLiveSessionState(row.text, row.updated_at);
    if (!isLiveSessionExpired(liveSession, nowMs)) continue;
    const result = await endLiveSession(env, row.channel_id, "expired", liveSession!.sessionId);
    if (result.status === "ended") {
      expiredCount += 1;
    }
  }
  return expiredCount;
}

export async function runScheduledMaintenance(env: Env, nowMs = Date.now()): Promise<{
  expiredLiveSessionsEnded: number;
  uploadTicketsDeleted: number;
  durableRateLimitsDeleted: number;
  operationalEventsDeleted: number;
  moderationAuditLogsDeleted: number;
  supportAuditLogsDeleted: number;
  messageActorIdentitiesDeleted: number;
  channelCleanupJobsAttempted: number;
  channelCleanupJobsCompleted: number;
  channelCleanupJobsPending: number;
  completedCleanupJobsDeleted: number;
  pendingAdminDeletionsFinalized: number;
}> {
  const expiredLiveSessionsEnded = await expireTimedOutLiveSessions(env, nowMs);
  const pendingAdminDeletionsFinalized = await finalizeExpiredAdminDeletions(env, nowMs);
  const channelCleanup = await retryPendingChannelCleanups(env, nowMs, CHANNEL_CLEANUP_RETRY_LIMIT);
  const uploadTicketsDeleted = await drainExpiredUploadTicketRetention(env);
  const durableRateLimitsDeleted = await drainTableRetention(
    env,
    "durable_rate_limits",
    "updated_at",
    cutoffIso(DURABLE_RATE_LIMIT_RETENTION_MS, nowMs),
  );
  const operationalEventsDeleted = await drainTableRetention(
    env,
    "operational_events",
    "created_at",
    cutoffIso(OPERATIONAL_EVENTS_RETENTION_MS, nowMs),
  );
  const moderationAuditLogsDeleted = await drainTableRetention(
    env,
    "moderation_audit_logs",
    "created_at",
    cutoffIso(MODERATION_AUDIT_RETENTION_MS, nowMs),
  );
  const supportAuditLogsDeleted = await drainTableRetention(
    env,
    "support_audit_logs",
    "created_at",
    cutoffIso(SUPPORT_AUDIT_RETENTION_MS, nowMs),
  );
  const messageActorIdentitiesDeleted = await drainTableRetention(
    env,
    "message_actor_identities",
    "created_at",
    cutoffIso(MESSAGE_ACTOR_IDENTITY_RETENTION_MS, nowMs),
  );
  const completedCleanupJobsDeleted = await drainCompletedCleanupJobRetention(
    env,
    cutoffIso(COMPLETED_CLEANUP_JOB_RETENTION_MS, nowMs),
  );

  return {
    expiredLiveSessionsEnded,
    uploadTicketsDeleted,
    durableRateLimitsDeleted,
    operationalEventsDeleted,
    moderationAuditLogsDeleted,
    supportAuditLogsDeleted,
    messageActorIdentitiesDeleted,
    channelCleanupJobsAttempted: channelCleanup.attempted,
    channelCleanupJobsCompleted: channelCleanup.completed,
    channelCleanupJobsPending: channelCleanup.pending,
    completedCleanupJobsDeleted,
    pendingAdminDeletionsFinalized,
  };
}
