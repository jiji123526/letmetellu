import type { Env } from "../types.ts";

export interface BillingSubscriptionRow {
  id: string;
  user_id: string;
  provider: string;
  plan: string;
  billing_cycle: string;
  provider_customer_key: string;
  billing_key: string;
  status: string;
  current_period_order_id: string | null;
  current_period_started_at: string;
  current_period_ends_at: string;
  next_charge_at: string;
  last_charged_at: string | null;
  last_failed_at: string | null;
  failure_count: number;
  cancel_requested_at: string | null;
  canceled_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export const BILLING_RENEWAL_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
export const BILLING_RENEWAL_BATCH_LIMIT = 20;
export const BILLING_RENEWAL_MAX_FAILURES = 3;

export function calculateBillingSubscriptionRetryAt(
  failedAt: string,
  delayMs = BILLING_RENEWAL_RETRY_DELAY_MS,
): string {
  return new Date(new Date(failedAt).getTime() + delayMs).toISOString();
}

export async function upsertBillingSubscription(env: Env, input: {
  userId: string;
  provider: string;
  plan: string;
  billingCycle: string;
  providerCustomerKey: string;
  billingKey: string;
  currentPeriodOrderId: string;
  currentPeriodStartedAt: string;
  currentPeriodEndsAt: string;
  lastChargedAt: string;
  now?: string;
}): Promise<void> {
  const now = input.now || new Date().toISOString();
  const existing = await env.DB.prepare(`
    SELECT id
    FROM billing_subscriptions
    WHERE user_id = ? AND provider = ? AND plan = ?
    LIMIT 1
  `).bind(
    input.userId,
    input.provider,
    input.plan,
  ).first<{ id: string }>();

  if (existing?.id) {
    await env.DB.prepare(`
      UPDATE billing_subscriptions
      SET billing_cycle = ?,
          provider_customer_key = ?,
          billing_key = ?,
          status = 'active',
          current_period_order_id = ?,
          current_period_started_at = ?,
          current_period_ends_at = ?,
          next_charge_at = ?,
          last_charged_at = ?,
          last_failed_at = NULL,
          failure_count = 0,
          cancel_requested_at = NULL,
          canceled_at = NULL,
          updated_at = ?
      WHERE id = ?
    `).bind(
      input.billingCycle,
      input.providerCustomerKey,
      input.billingKey,
      input.currentPeriodOrderId,
      input.currentPeriodStartedAt,
      input.currentPeriodEndsAt,
      input.currentPeriodEndsAt,
      input.lastChargedAt,
      now,
      existing.id,
    ).run();
    return;
  }

  await env.DB.prepare(`
    INSERT INTO billing_subscriptions (
      id, user_id, provider, plan, billing_cycle,
      provider_customer_key, billing_key, status,
      current_period_order_id, current_period_started_at,
      current_period_ends_at, next_charge_at, last_charged_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.userId,
    input.provider,
    input.plan,
    input.billingCycle,
    input.providerCustomerKey,
    input.billingKey,
    input.currentPeriodOrderId,
    input.currentPeriodStartedAt,
    input.currentPeriodEndsAt,
    input.currentPeriodEndsAt,
    input.lastChargedAt,
  ).run();
}

export async function readDueBillingSubscriptions(
  env: Env,
  now: string,
  limit = BILLING_RENEWAL_BATCH_LIMIT,
): Promise<BillingSubscriptionRow[]> {
  const result = await env.DB.prepare(`
    SELECT id, user_id, provider, plan, billing_cycle,
           provider_customer_key, billing_key, status,
           current_period_order_id, current_period_started_at,
           current_period_ends_at, next_charge_at, last_charged_at,
           last_failed_at, failure_count, cancel_requested_at, canceled_at,
           created_at, updated_at
    FROM billing_subscriptions
    WHERE status IN ('active', 'past_due')
      AND next_charge_at <= ?
      AND canceled_at IS NULL
    ORDER BY next_charge_at ASC, updated_at ASC
    LIMIT ?
  `).bind(now, limit).all<BillingSubscriptionRow>();
  return result.results || [];
}

export async function markBillingSubscriptionRenewed(env: Env, input: {
  subscriptionId: string;
  currentPeriodOrderId: string;
  currentPeriodStartedAt: string;
  currentPeriodEndsAt: string;
  lastChargedAt: string;
  now?: string;
}): Promise<void> {
  const now = input.now || new Date().toISOString();
  await env.DB.prepare(`
    UPDATE billing_subscriptions
    SET status = 'active',
        current_period_order_id = ?,
        current_period_started_at = ?,
        current_period_ends_at = ?,
        next_charge_at = ?,
        last_charged_at = ?,
        last_failed_at = NULL,
        failure_count = 0,
        updated_at = ?
    WHERE id = ?
  `).bind(
    input.currentPeriodOrderId,
    input.currentPeriodStartedAt,
    input.currentPeriodEndsAt,
    input.currentPeriodEndsAt,
    input.lastChargedAt,
    now,
    input.subscriptionId,
  ).run();
}

export async function markBillingSubscriptionRenewalFailed(env: Env, input: {
  subscriptionId: string;
  failedAt: string;
  now?: string;
}): Promise<void> {
  const now = input.now || new Date().toISOString();
  const retryAt = calculateBillingSubscriptionRetryAt(input.failedAt);
  await env.DB.prepare(`
    UPDATE billing_subscriptions
    SET status = CASE
          WHEN failure_count + 1 >= ? THEN 'non_renewing'
          ELSE 'past_due'
        END,
        next_charge_at = CASE
          WHEN failure_count + 1 >= ? THEN current_period_ends_at
          ELSE ?
        END,
        last_failed_at = ?,
        failure_count = failure_count + 1,
        cancel_requested_at = CASE
          WHEN failure_count + 1 >= ? THEN COALESCE(cancel_requested_at, ?)
          ELSE cancel_requested_at
        END,
        updated_at = ?
    WHERE id = ?
  `).bind(
    BILLING_RENEWAL_MAX_FAILURES,
    BILLING_RENEWAL_MAX_FAILURES,
    retryAt,
    input.failedAt,
    BILLING_RENEWAL_MAX_FAILURES,
    input.failedAt,
    now,
    input.subscriptionId,
  ).run();
}

export async function readBillingSubscriptionForUser(
  env: Env,
  userId: string,
  plan = "plus",
): Promise<BillingSubscriptionRow | null> {
  return env.DB.prepare(`
    SELECT id, user_id, provider, plan, billing_cycle,
           provider_customer_key, billing_key, status,
           current_period_order_id, current_period_started_at,
           current_period_ends_at, next_charge_at, last_charged_at,
           last_failed_at, failure_count, cancel_requested_at, canceled_at,
           created_at, updated_at
    FROM billing_subscriptions
    WHERE user_id = ? AND plan = ?
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `).bind(userId, plan).first<BillingSubscriptionRow>();
}

export async function markBillingSubscriptionCancelRequested(
  env: Env,
  orderId: string,
  effectiveAt: string,
  providerSubscriptionId?: string | null,
): Promise<void> {
  await env.DB.prepare(`
    UPDATE billing_subscriptions
    SET status = 'non_renewing',
        cancel_requested_at = COALESCE(cancel_requested_at, ?),
        updated_at = ?,
        provider_customer_key = provider_customer_key
    WHERE current_period_order_id = ?
  `).bind(
    effectiveAt,
    effectiveAt,
    orderId,
  ).run();
  void providerSubscriptionId;
}

export async function markBillingSubscriptionCanceled(
  env: Env,
  orderId: string,
  effectiveAt: string,
): Promise<void> {
  await env.DB.prepare(`
    UPDATE billing_subscriptions
    SET status = 'canceled',
        canceled_at = COALESCE(canceled_at, ?),
        next_charge_at = ?,
        updated_at = ?
    WHERE current_period_order_id = ?
  `).bind(
    effectiveAt,
    effectiveAt,
    effectiveAt,
    orderId,
  ).run();
}
