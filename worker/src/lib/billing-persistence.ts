import type { Env } from "../types.ts";
import {
  calculateBillingEntitlementEndsAt,
  type BillingPlanSelection,
  resolveBillingPlanSelection,
} from "./billing-plans.ts";

export interface PendingBillingOrderRow {
  order_id: string;
  user_id?: string;
  plan: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  provider: string;
  provider_order_id?: string | null;
  status: string;
  auto_renews: number;
  expires_at: string | null;
}

export interface PaymentRow {
  provider_payment_id: string;
  order_id: string;
  user_id: string;
  provider: string;
  method: string | null;
  amount: number;
  currency: string;
  status: string;
  approved_at: string | null;
  canceled_at: string | null;
}

export interface BillingEntitlementRow {
  id: string;
  user_id: string;
  provider: string | null;
  plan: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  source_order_id: string | null;
  source_type: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  auto_renews: number;
}

export type BillingPersistenceResult =
  | { ok: false; error: string; status: number }
  | {
      ok: true;
      reusedPayment: boolean;
      selection: BillingPlanSelection;
      order: PendingBillingOrderRow;
      payment: PaymentRow;
      entitlement: BillingEntitlementRow;
    };

export async function readBillingEntitlementByOrderId(
  env: Env,
  orderId: string,
): Promise<BillingEntitlementRow | null> {
  return env.DB.prepare(`
    SELECT id, user_id, provider, plan, status, starts_at, ends_at,
           source_order_id, source_type, provider_customer_id,
           provider_subscription_id, auto_renews
    FROM user_entitlements
    WHERE source_order_id = ? AND source_type = 'billing'
    ORDER BY starts_at DESC, updated_at DESC
    LIMIT 1
  `).bind(orderId).first<BillingEntitlementRow>();
}

export async function persistBillingConfirmation(input: {
  env: Env;
  userId: string;
  order: PendingBillingOrderRow;
  provider: string;
  providerOrderId: string;
  providerPaymentId: string;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  approvedAt: string;
  entitlementStartsAt?: string;
}): Promise<BillingPersistenceResult> {
  const selection = resolveBillingPlanSelection({
    plan: input.order.plan,
    billingCycle: input.order.billing_cycle,
    provider: input.order.provider,
  });
  if (!selection) {
    return { ok: false, error: "unsupported_order_plan", status: 409 };
  }

  if (
    input.order.provider !== input.provider
    || input.order.amount !== input.amount
    || input.order.currency !== input.currency
  ) {
    return { ok: false, error: "confirmation_mismatch", status: 409 };
  }

  if (input.order.provider_order_id && input.order.provider_order_id !== input.providerOrderId) {
    return { ok: false, error: "provider_order_conflict", status: 409 };
  }

  if (input.order.status !== "pending" && input.order.status !== "confirmed") {
    return { ok: false, error: "order_not_confirmable", status: 409 };
  }

  const now = new Date().toISOString();
  if (input.order.status === "pending" && input.order.expires_at && input.order.expires_at <= now) {
    return { ok: false, error: "order_expired", status: 409 };
  }

  const existingPayment = await input.env.DB.prepare(`
    SELECT provider_payment_id, order_id, user_id, provider, method,
           amount, currency, status, approved_at, canceled_at
    FROM payments
    WHERE provider_payment_id = ?
    LIMIT 1
  `).bind(input.providerPaymentId).first<PaymentRow>();
  if (existingPayment && (existingPayment.order_id !== input.order.order_id || existingPayment.user_id !== input.userId)) {
    return { ok: false, error: "payment_conflict", status: 409 };
  }

  const entitlementId = `billing-order:${input.order.order_id}`;
  const entitlementStartsAt = input.entitlementStartsAt || input.approvedAt;
  const entitlementEndsAt = calculateBillingEntitlementEndsAt(entitlementStartsAt, selection.durationDays);

  if (!existingPayment) {
    await input.env.DB.prepare(`
      INSERT INTO payments (
        provider_payment_id, order_id, user_id, provider, method,
        amount, currency, status, approved_at, canceled_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, NULL, ?)
    `).bind(
      input.providerPaymentId,
      input.order.order_id,
      input.userId,
      input.provider,
      input.paymentMethod,
      input.amount,
      input.currency,
      input.approvedAt,
      now,
    ).run();
  }

  await input.env.DB.prepare(`
    UPDATE billing_orders
    SET provider_order_id = ?, status = 'confirmed', updated_at = ?
    WHERE order_id = ? AND user_id = ?
  `).bind(
    input.providerOrderId,
    now,
    input.order.order_id,
    input.userId,
  ).run();

  await input.env.DB.prepare(`
    INSERT OR IGNORE INTO user_entitlements (
      id, user_id, provider, plan, status, starts_at, ends_at,
      source_order_id, source_type, provider_customer_id,
      provider_subscription_id, auto_renews, grandfathered_channel_id, updated_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 'billing', ?, ?, ?, NULL, ?)
  `).bind(
    entitlementId,
    input.userId,
    input.provider,
    selection.plan,
    entitlementStartsAt,
    entitlementEndsAt,
    input.order.order_id,
    input.providerCustomerId,
    input.providerSubscriptionId,
    selection.autoRenews ? 1 : 0,
    now,
  ).run();

  const [confirmedOrder, payment, entitlement] = await Promise.all([
    input.env.DB.prepare(`
      SELECT order_id, user_id, plan, billing_cycle, amount, currency,
             provider, provider_order_id, status, auto_renews, expires_at
      FROM billing_orders
      WHERE order_id = ? AND user_id = ?
      LIMIT 1
    `).bind(input.order.order_id, input.userId).first<PendingBillingOrderRow>(),
    input.env.DB.prepare(`
      SELECT provider_payment_id, order_id, user_id, provider, method,
             amount, currency, status, approved_at, canceled_at
      FROM payments
      WHERE provider_payment_id = ?
      LIMIT 1
    `).bind(input.providerPaymentId).first<PaymentRow>(),
    input.env.DB.prepare(`
      SELECT id, user_id, provider, plan, status, starts_at, ends_at,
             source_order_id, source_type, provider_customer_id,
             provider_subscription_id, auto_renews
      FROM user_entitlements
      WHERE id = ?
      LIMIT 1
    `).bind(entitlementId).first<BillingEntitlementRow>(),
  ]);

  if (!confirmedOrder || !payment || !entitlement) {
    return { ok: false, error: "confirmation_persist_failed", status: 500 };
  }

  return {
    ok: true,
    reusedPayment: Boolean(existingPayment),
    selection,
    order: confirmedOrder,
    payment,
    entitlement,
  };
}
