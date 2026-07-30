import type { Env } from "../types";
import { cleanupExpiredUploadTickets } from "./upload-tickets";

const DAY_MS = 24 * 60 * 60 * 1000;
const DURABLE_RATE_LIMIT_RETENTION_MS = 7 * DAY_MS;
const OPERATIONAL_EVENTS_RETENTION_MS = 30 * DAY_MS;
const MODERATION_AUDIT_RETENTION_MS = 365 * DAY_MS;
const CLEANUP_BATCH_LIMIT = 250;
const CLEANUP_MAX_BATCHES = 8;

function cutoffIso(retentionMs: number, nowMs: number): string {
  return new Date(nowMs - retentionMs).toISOString();
}

async function deleteRowsByRowId(
  env: Env,
  table: "durable_rate_limits" | "operational_events" | "moderation_audit_logs",
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
  table: "durable_rate_limits" | "operational_events" | "moderation_audit_logs",
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

export async function runScheduledMaintenance(env: Env, nowMs = Date.now()): Promise<{
  uploadTicketsDeleted: number;
  durableRateLimitsDeleted: number;
  operationalEventsDeleted: number;
  moderationAuditLogsDeleted: number;
}> {
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

  return {
    uploadTicketsDeleted,
    durableRateLimitsDeleted,
    operationalEventsDeleted,
    moderationAuditLogsDeleted,
  };
}
