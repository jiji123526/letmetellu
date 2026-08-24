import webpush from "web-push";
import type { Env } from "../types.ts";

const DELIVERY_BATCH_SIZE = 10;
const DELIVERY_LEASE_MS = 2 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];

interface DeliveryRow {
  id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  payload_json: string;
  attempt_count: number;
  event_type: string;
  aggregate_count: number;
}

interface DeliveryCandidate {
  id: string;
  created_at: string;
}

function isConfigured(env: Env): boolean {
  return /^[A-Za-z0-9_-]{87}$/.test(env.VAPID_PUBLIC_KEY || "")
    && /^[A-Za-z0-9_-]{43}$/.test(env.VAPID_PRIVATE_KEY || "")
    && /^(mailto:|https:)/.test(env.VAPID_SUBJECT || "");
}

function errorStatus(error: unknown): number {
  if (!error || typeof error !== "object") return 0;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : 0;
}

function boundedErrorCode(status: number, error?: unknown): string {
  if (status > 0) return `push_http_${status}`;
  if (!error || typeof error !== "object") return "push_transport_error";
  const directCode = (error as { code?: unknown }).code;
  const causeCode = (error as { cause?: { code?: unknown } }).cause?.code;
  const candidate = typeof directCode === "string" ? directCode : causeCode;
  if (typeof candidate !== "string" || !/^[A-Z0-9_]{1,48}$/.test(candidate)) {
    return "push_transport_error";
  }
  return `push_transport_${candidate.toLowerCase()}`;
}

async function markDelivered(env: Env, row: DeliveryRow, now: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE notification_outbox
      SET status = 'delivered', lease_until = NULL, last_error_code = NULL, updated_at = ?
      WHERE id = ? AND status = 'processing'
    `).bind(now, row.id),
    env.DB.prepare(`
      UPDATE push_subscriptions
      SET last_success_at = ?, failure_count = 0, last_failure_at = NULL, updated_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `).bind(now, now, row.subscription_id),
  ]);
}

async function markGone(env: Env, row: DeliveryRow, status: number, now: string): Promise<void> {
  const code = boundedErrorCode(status);
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE notification_outbox
      SET status = 'dead', lease_until = NULL, last_error_code = ?, updated_at = ?
      WHERE id = ? AND status = 'processing'
    `).bind(code, now, row.id),
    env.DB.prepare(`
      UPDATE push_subscriptions
      SET revoked_at = ?, last_failure_at = ?, failure_count = failure_count + 1, updated_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `).bind(now, now, now, row.subscription_id),
  ]);
}

async function markFailed(env: Env, row: DeliveryRow, status: number, nowMs: number, error?: unknown): Promise<void> {
  const now = new Date(nowMs).toISOString();
  const code = boundedErrorCode(status, error);
  const shouldRetry = row.attempt_count < MAX_DELIVERY_ATTEMPTS && (status === 0 || status === 408 || status === 429 || status >= 500);
  const nextDelay = RETRY_DELAYS_MS[Math.min(row.attempt_count - 1, RETRY_DELAYS_MS.length - 1)];
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE notification_outbox
      SET status = ?, next_attempt_at = ?, lease_until = NULL, last_error_code = ?, updated_at = ?
      WHERE id = ? AND status = 'processing'
    `).bind(
      shouldRetry ? "retry" : "dead",
      new Date(nowMs + (shouldRetry ? nextDelay : 0)).toISOString(),
      code,
      now,
      row.id,
    ),
    env.DB.prepare(`
      UPDATE push_subscriptions
      SET last_failure_at = ?, failure_count = failure_count + 1, updated_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `).bind(now, now, row.subscription_id),
  ]);
}

async function claimRows(env: Env, nowMs: number, limit: number, preferredId?: string): Promise<DeliveryRow[]> {
  const now = new Date(nowMs).toISOString();
  const leaseUntil = new Date(nowMs + DELIVERY_LEASE_MS).toISOString();
  let candidates: DeliveryCandidate[];
  if (preferredId) {
    const { results } = await env.DB.prepare(`
    SELECT outbox.id, outbox.created_at
    FROM notification_outbox outbox
    WHERE outbox.id = ? AND (
      (outbox.status IN ('pending', 'retry') AND outbox.next_attempt_at <= ?)
      OR (outbox.status = 'processing' AND outbox.lease_until < ?)
    )
    LIMIT 1
  `).bind(preferredId, now, now).all<DeliveryCandidate>();
    candidates = results;
  } else {
    const [readyResult, expiredLeaseResult] = await env.DB.batch<DeliveryCandidate>([
      env.DB.prepare(`
        SELECT id, created_at
        FROM notification_outbox
        WHERE status IN ('pending', 'retry')
          AND next_attempt_at <= ?
        ORDER BY next_attempt_at ASC, created_at ASC, id ASC
        LIMIT ?
      `).bind(now, limit),
      env.DB.prepare(`
        SELECT id, created_at
        FROM notification_outbox
        WHERE status = 'processing'
          AND lease_until < ?
        ORDER BY lease_until ASC, created_at ASC, id ASC
        LIMIT ?
      `).bind(now, limit),
    ]);
    candidates = [...readyResult.results, ...expiredLeaseResult.results]
      .sort((left, right) => (
        left.created_at.localeCompare(right.created_at)
        || left.id.localeCompare(right.id)
      ))
      .slice(0, limit);
  }

  const claimed: DeliveryRow[] = [];
  for (const candidate of candidates) {
    const claim = await env.DB.prepare(`
      UPDATE notification_outbox
      SET status = 'processing', attempt_count = attempt_count + 1, lease_until = ?, updated_at = ?
      WHERE id = ? AND (
        (status IN ('pending', 'retry') AND next_attempt_at <= ?)
        OR (status = 'processing' AND lease_until < ?)
      )
    `).bind(leaseUntil, now, candidate.id, now, now).run();
    if (!claim.meta.changes) continue;
    const row = await env.DB.prepare(`
      SELECT outbox.id, outbox.subscription_id, outbox.payload_json, outbox.attempt_count,
             outbox.event_type, outbox.aggregate_count,
             subscription.endpoint, subscription.p256dh, subscription.auth
      FROM notification_outbox outbox
      INNER JOIN push_subscriptions subscription ON subscription.id = outbox.subscription_id
      WHERE outbox.id = ? AND outbox.status = 'processing' AND subscription.revoked_at IS NULL
      LIMIT 1
    `).bind(candidate.id).first<DeliveryRow>();
    if (row) claimed.push(row);
    else {
      await env.DB.prepare(`
        UPDATE notification_outbox
        SET status = 'dead', lease_until = NULL, last_error_code = 'subscription_unavailable', updated_at = ?
        WHERE id = ? AND status = 'processing'
      `).bind(now, candidate.id).run();
    }
  }
  return claimed;
}

export async function processNotificationOutbox(
  env: Env,
  limit = DELIVERY_BATCH_SIZE,
  preferredId?: string,
): Promise<number> {
  if (!isConfigured(env)) throw new Error("VAPID delivery is not configured");
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

  const rows = await claimRows(env, Date.now(), Math.max(1, Math.min(limit, DELIVERY_BATCH_SIZE)), preferredId);
  await Promise.all(rows.map(async (row) => {
    try {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      if (row.event_type === "channel_message" && row.aggregate_count > 1) {
        const locale = payload.locale === "en" ? "en" : "ko";
        const channelName = typeof payload.channelName === "string" ? payload.channelName : "yap.";
        payload.title = locale === "en"
          ? `[${channelName}] ${row.aggregate_count} new messages have arrived`
          : `[${channelName}] 새 메시지 ${row.aggregate_count}개가 도착했어요`;
        payload.body = "";
      }
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
        { TTL: 60, urgency: "normal" },
      );
      await markDelivered(env, row, new Date().toISOString());
    } catch (error) {
      const status = errorStatus(error);
      if (status === 404 || status === 410) {
        await markGone(env, row, status, new Date().toISOString());
      } else {
        await markFailed(env, row, status, Date.now(), error);
      }
    }
  }));
  return rows.length;
}

export async function drainNotificationOutbox(env: Env, maxBatches = 3): Promise<number> {
  let processed = 0;
  for (let batch = 0; batch < Math.max(1, Math.min(maxBatches, 3)); batch += 1) {
    const count = await processNotificationOutbox(env);
    processed += count;
    if (count < DELIVERY_BATCH_SIZE) break;
  }
  return processed;
}
