import type { Env } from "../types.ts";
import { calculateBillingEntitlementEndsAt, resolveBillingPlanSelection } from "./billing-plans.ts";
import {
  BILLING_RENEWAL_BATCH_LIMIT,
  BILLING_RENEWAL_MAX_FAILURES,
  markBillingSubscriptionRenewalFailed,
  markBillingSubscriptionRenewed,
  readDueBillingSubscriptions,
  type BillingSubscriptionRow,
} from "./billing-subscriptions.ts";
import { persistBillingConfirmation, type PendingBillingOrderRow } from "./billing-persistence.ts";
import { ensureDefaultChannelRetentionChoice } from "./channel-plan-locks.ts";
import { isValidTossBillingCharge } from "./toss-billing.ts";

function getTossApiAuthorizationHeader(secretKey: string): string {
  return `Basic ${btoa(`${secretKey}:`)}`;
}

function buildRenewalOrderName(subscription: BillingSubscriptionRow): string {
  return subscription.billing_cycle === "yearly"
    ? "yap. Plus 365 days renewal"
    : "yap. Plus 30 days renewal";
}

function buildRenewalOrderRow(input: {
  subscription: BillingSubscriptionRow;
  selectionAmount: number;
  selectionCurrency: string;
}): PendingBillingOrderRow {
  return {
    order_id: crypto.randomUUID(),
    user_id: input.subscription.user_id,
    plan: input.subscription.plan,
    billing_cycle: input.subscription.billing_cycle,
    amount: input.selectionAmount,
    currency: input.selectionCurrency,
    provider: input.subscription.provider,
    provider_order_id: null,
    status: "pending",
    auto_renews: 1,
    expires_at: null,
  };
}

async function createRenewalOrder(env: Env, order: PendingBillingOrderRow): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO billing_orders (
      order_id, user_id, plan, billing_cycle, amount, currency,
      provider, status, auto_renews, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)
  `).bind(
    order.order_id,
    order.user_id,
    order.plan,
    order.billing_cycle,
    order.amount,
    order.currency,
    order.provider,
    order.auto_renews,
  ).run();
}

async function markRenewalOrderFailed(env: Env, orderId: string, now: string): Promise<void> {
  await env.DB.prepare(`
    UPDATE billing_orders
    SET status = 'failed', updated_at = ?
    WHERE order_id = ?
  `).bind(now, orderId).run();
}

async function recordRenewalFailure(
  env: Env,
  subscription: BillingSubscriptionRow,
  now: string,
): Promise<void> {
  await markBillingSubscriptionRenewalFailed(env, {
    subscriptionId: subscription.id,
    failedAt: now,
    now,
  });
  if (Number(subscription.failure_count) + 1 < BILLING_RENEWAL_MAX_FAILURES) {
    return;
  }

  await env.DB.prepare(`
    UPDATE user_entitlements
    SET auto_renews = 0,
        updated_at = ?
    WHERE user_id = ?
      AND plan = ?
      AND status = 'active'
      AND ends_at = ?
  `).bind(
    now,
    subscription.user_id,
    subscription.plan,
    subscription.current_period_ends_at,
  ).run();
  await ensureDefaultChannelRetentionChoice(
    env,
    subscription.user_id,
    subscription.current_period_ends_at,
  );
}

export async function runBillingSubscriptionRenewals(
  env: Env,
  now = new Date().toISOString(),
): Promise<{
  attempted: number;
  renewed: number;
  failed: number;
}> {
  const secretKey = env.TOSS_PAYMENTS_SECRET_KEY?.trim() || "";
  if (!secretKey) {
    return { attempted: 0, renewed: 0, failed: 0 };
  }

  const dueSubscriptions = await readDueBillingSubscriptions(env, now, BILLING_RENEWAL_BATCH_LIMIT);
  let attempted = 0;
  let renewed = 0;
  let failed = 0;

  for (const subscription of dueSubscriptions) {
    const selection = resolveBillingPlanSelection({
      plan: subscription.plan,
      billingCycle: subscription.billing_cycle,
      provider: subscription.provider,
    });
    if (!selection) {
      failed += 1;
      await recordRenewalFailure(env, subscription, now);
      continue;
    }

    attempted += 1;
    const order = buildRenewalOrderRow({
      subscription,
      selectionAmount: selection.amount,
      selectionCurrency: selection.currency,
    });
    await createRenewalOrder(env, order);

    const chargeResponse = await fetch(`https://api.tosspayments.com/v1/billing/${encodeURIComponent(subscription.billing_key)}`, {
      method: "POST",
      headers: {
        Authorization: getTossApiAuthorizationHeader(secretKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customerKey: subscription.provider_customer_key,
        amount: selection.amount,
        orderId: order.order_id,
        orderName: buildRenewalOrderName(subscription),
      }),
    });
    const chargeData = await chargeResponse.json().catch(() => ({})) as Record<string, unknown>;

    if (!chargeResponse.ok || !isValidTossBillingCharge(chargeData, {
      orderId: order.order_id,
      amount: selection.amount,
      currency: selection.currency,
    })) {
      failed += 1;
      await markRenewalOrderFailed(env, order.order_id, now);
      await recordRenewalFailure(env, subscription, now);
      continue;
    }

    const approvedAt = typeof chargeData.approvedAt === "string"
      ? new Date(chargeData.approvedAt).toISOString()
      : now;
    const persisted = await persistBillingConfirmation({
      env,
      userId: subscription.user_id,
      order,
      provider: subscription.provider,
      providerOrderId: chargeData.orderId,
      providerPaymentId: chargeData.paymentKey,
      amount: chargeData.totalAmount,
      currency: selection.currency,
      paymentMethod: chargeData.method || "card",
      providerCustomerId: subscription.provider_customer_key,
      providerSubscriptionId: null,
      approvedAt,
      entitlementStartsAt: subscription.current_period_ends_at,
    });

    if (!persisted.ok) {
      failed += 1;
      await markRenewalOrderFailed(env, order.order_id, now);
      await recordRenewalFailure(env, subscription, now);
      continue;
    }

    const nextPeriodEndsAt = calculateBillingEntitlementEndsAt(
      subscription.current_period_ends_at,
      selection.durationDays,
    );
    await markBillingSubscriptionRenewed(env, {
      subscriptionId: subscription.id,
      currentPeriodOrderId: order.order_id,
      currentPeriodStartedAt: subscription.current_period_ends_at,
      currentPeriodEndsAt: nextPeriodEndsAt,
      lastChargedAt: approvedAt,
      now,
    });
    renewed += 1;
  }

  return { attempted, renewed, failed };
}
