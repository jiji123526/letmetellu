import type { Env } from "../types.ts";
import {
  calculateBillingEntitlementEndsAt,
  calculateBillingOrderExpiresAt,
  resolveBillingPlanSelection,
} from "../lib/billing-plans.ts";
import {
  ensureBetaGrandfatheredPlusEntitlement,
  isBetaGrandfatherAllUsersEnabled,
  readActivePlusEntitlement,
} from "../lib/plan-entitlements.ts";
import { isTrustedInternalRequest } from "../lib/trusted-identity.ts";

interface PendingBillingOrderRow {
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

interface PaymentRow {
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

interface BillingEntitlementRow {
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

function buildOrderResponse(
  order: PendingBillingOrderRow,
  taxMode: "vat_exclusive",
) {
  return {
    order_id: order.order_id,
    plan: order.plan,
    billing_cycle: order.billing_cycle,
    amount: Number(order.amount),
    currency: order.currency,
    provider: order.provider,
    provider_order_id: order.provider_order_id || null,
    status: order.status,
    auto_renews: Number(order.auto_renews) === 1,
    expires_at: order.expires_at,
    tax_mode: taxMode,
  };
}

function buildPaymentResponse(payment: PaymentRow) {
  return {
    provider_payment_id: payment.provider_payment_id,
    provider: payment.provider,
    method: payment.method,
    amount: Number(payment.amount),
    currency: payment.currency,
    status: payment.status,
    approved_at: payment.approved_at,
    canceled_at: payment.canceled_at,
  };
}

function buildEntitlementResponse(entitlement: BillingEntitlementRow) {
  return {
    id: entitlement.id,
    plan: entitlement.plan,
    status: entitlement.status,
    starts_at: entitlement.starts_at,
    ends_at: entitlement.ends_at,
    source_type: entitlement.source_type,
    provider_customer_id: entitlement.provider_customer_id,
    provider_subscription_id: entitlement.provider_subscription_id,
    auto_renews: Number(entitlement.auto_renews) === 1,
  };
}

function isIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

async function handleBillingOrderCreate(request: Request, env: Env, userId: string): Promise<Response> {
  const user = await env.DB.prepare(
    "SELECT id FROM users WHERE id = ? LIMIT 1",
  ).bind(userId).first<{ id: string }>();
  if (!user) {
    return Response.json({ error: "user_not_found" }, { status: 404 });
  }

  const body = await request.json() as {
    plan?: unknown;
    billing_cycle?: unknown;
    provider?: unknown;
  };
  const selection = resolveBillingPlanSelection({
    plan: body.plan,
    billingCycle: body.billing_cycle,
    provider: body.provider,
  });
  if (!selection) {
    return Response.json({ error: "invalid_plan_selection" }, { status: 400 });
  }

  const now = new Date().toISOString();
  let activeEntitlement = await readActivePlusEntitlement(env, userId, now);
  if (!activeEntitlement && isBetaGrandfatherAllUsersEnabled(env)) {
    activeEntitlement = await ensureBetaGrandfatheredPlusEntitlement(env, userId, now);
  }
  if (activeEntitlement) {
    return Response.json({
      error: "already_entitled",
      entitlement: {
        plan: activeEntitlement.plan,
        status: activeEntitlement.status,
        source_type: activeEntitlement.source_type,
        starts_at: activeEntitlement.starts_at,
        ends_at: activeEntitlement.ends_at,
        auto_renews: Number(activeEntitlement.auto_renews) === 1,
      },
    }, { status: 409 });
  }

  const existingPending = await env.DB.prepare(`
    SELECT order_id, plan, billing_cycle, amount, currency,
           provider, provider_order_id, status, auto_renews, expires_at
    FROM billing_orders
    WHERE user_id = ?
      AND plan = ?
      AND billing_cycle = ?
      AND provider = ?
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at DESC, order_id DESC
    LIMIT 1
  `).bind(
    userId,
    selection.plan,
    selection.billingCycle,
    selection.provider,
    now,
  ).first<PendingBillingOrderRow>();

  if (existingPending) {
    return Response.json({
      ok: true,
      reused: true,
      order: buildOrderResponse(existingPending, selection.taxMode),
    });
  }

  const orderId = crypto.randomUUID();
  const expiresAt = calculateBillingOrderExpiresAt(now);
  await env.DB.prepare(`
    INSERT INTO billing_orders (
      order_id, user_id, plan, billing_cycle, amount, currency,
      provider, status, auto_renews, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(
    orderId,
    userId,
    selection.plan,
    selection.billingCycle,
    selection.amount,
    selection.currency,
    selection.provider,
    selection.autoRenews ? 1 : 0,
    expiresAt,
  ).run();

  return Response.json({
    ok: true,
    reused: false,
    order: buildOrderResponse({
      order_id: orderId,
      plan: selection.plan,
      billing_cycle: selection.billingCycle,
      amount: selection.amount,
      currency: selection.currency,
      provider: selection.provider,
      provider_order_id: null,
      status: "pending",
      auto_renews: selection.autoRenews ? 1 : 0,
      expires_at: expiresAt,
    }, selection.taxMode),
  }, { status: 201 });
}

async function handleBillingConfirm(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json() as {
    order_id?: unknown;
    provider?: unknown;
    provider_order_id?: unknown;
    provider_payment_id?: unknown;
    amount?: unknown;
    currency?: unknown;
    payment_method?: unknown;
    provider_customer_id?: unknown;
    provider_subscription_id?: unknown;
    approved_at?: unknown;
  };

  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const providerOrderId = typeof body.provider_order_id === "string" ? body.provider_order_id.trim() : "";
  const providerPaymentId = typeof body.provider_payment_id === "string" ? body.provider_payment_id.trim() : "";
  const paymentMethod = typeof body.payment_method === "string" ? body.payment_method.trim() : null;
  const providerCustomerId = typeof body.provider_customer_id === "string"
    ? body.provider_customer_id.trim()
    : null;
  const providerSubscriptionId = typeof body.provider_subscription_id === "string"
    ? body.provider_subscription_id.trim()
    : null;
  const approvedAtInput = typeof body.approved_at === "string" ? body.approved_at.trim() : "";
  const approvedAt = approvedAtInput && isIsoTimestamp(approvedAtInput)
    ? new Date(approvedAtInput).toISOString()
    : new Date().toISOString();
  const amount = typeof body.amount === "number" ? body.amount : Number.NaN;
  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";

  if (!orderId || !provider || !providerOrderId || !providerPaymentId || !Number.isInteger(amount) || !currency) {
    return Response.json({ error: "invalid_confirmation_payload" }, { status: 400 });
  }

  const order = await env.DB.prepare(`
    SELECT order_id, user_id, plan, billing_cycle, amount, currency,
           provider, provider_order_id, status, auto_renews, expires_at
    FROM billing_orders
    WHERE order_id = ? AND user_id = ?
    LIMIT 1
  `).bind(orderId, userId).first<PendingBillingOrderRow>();
  if (!order) {
    return Response.json({ error: "order_not_found" }, { status: 404 });
  }

  const selection = resolveBillingPlanSelection({
    plan: order.plan,
    billingCycle: order.billing_cycle,
    provider: order.provider,
  });
  if (!selection) {
    return Response.json({ error: "unsupported_order_plan" }, { status: 409 });
  }

  if (order.provider !== provider || order.amount !== amount || order.currency !== currency) {
    return Response.json({ error: "confirmation_mismatch" }, { status: 409 });
  }

  if (order.provider_order_id && order.provider_order_id !== providerOrderId) {
    return Response.json({ error: "provider_order_conflict" }, { status: 409 });
  }

  if (order.status !== "pending" && order.status !== "confirmed") {
    return Response.json({ error: "order_not_confirmable" }, { status: 409 });
  }

  const now = new Date().toISOString();
  if (order.status === "pending" && order.expires_at && order.expires_at <= now) {
    return Response.json({ error: "order_expired" }, { status: 409 });
  }

  const existingPayment = await env.DB.prepare(`
    SELECT provider_payment_id, order_id, user_id, provider, method,
           amount, currency, status, approved_at, canceled_at
    FROM payments
    WHERE provider_payment_id = ?
    LIMIT 1
  `).bind(providerPaymentId).first<PaymentRow>();
  if (existingPayment && (existingPayment.order_id !== orderId || existingPayment.user_id !== userId)) {
    return Response.json({ error: "payment_conflict" }, { status: 409 });
  }

  const entitlementId = `billing-order:${orderId}`;
  const entitlementEndsAt = calculateBillingEntitlementEndsAt(approvedAt, selection.durationDays);

  if (!existingPayment) {
    await env.DB.prepare(`
      INSERT INTO payments (
        provider_payment_id, order_id, user_id, provider, method,
        amount, currency, status, approved_at, canceled_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, NULL, ?)
    `).bind(
      providerPaymentId,
      orderId,
      userId,
      provider,
      paymentMethod,
      amount,
      currency,
      approvedAt,
      now,
    ).run();
  }

  await env.DB.prepare(`
    UPDATE billing_orders
    SET provider_order_id = ?, status = 'confirmed', updated_at = ?
    WHERE order_id = ? AND user_id = ?
  `).bind(
    providerOrderId,
    now,
    orderId,
    userId,
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO user_entitlements (
      id, user_id, provider, plan, status, starts_at, ends_at,
      source_order_id, source_type, provider_customer_id,
      provider_subscription_id, auto_renews, grandfathered_channel_id, updated_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 'billing', ?, ?, ?, NULL, ?)
  `).bind(
    entitlementId,
    userId,
    provider,
    selection.plan,
    approvedAt,
    entitlementEndsAt,
    orderId,
    providerCustomerId,
    providerSubscriptionId,
    selection.autoRenews ? 1 : 0,
    now,
  ).run();

  const [confirmedOrder, payment, entitlement] = await Promise.all([
    env.DB.prepare(`
      SELECT order_id, user_id, plan, billing_cycle, amount, currency,
             provider, provider_order_id, status, auto_renews, expires_at
      FROM billing_orders
      WHERE order_id = ? AND user_id = ?
      LIMIT 1
    `).bind(orderId, userId).first<PendingBillingOrderRow>(),
    env.DB.prepare(`
      SELECT provider_payment_id, order_id, user_id, provider, method,
             amount, currency, status, approved_at, canceled_at
      FROM payments
      WHERE provider_payment_id = ?
      LIMIT 1
    `).bind(providerPaymentId).first<PaymentRow>(),
    env.DB.prepare(`
      SELECT id, user_id, provider, plan, status, starts_at, ends_at,
             source_order_id, source_type, provider_customer_id,
             provider_subscription_id, auto_renews
      FROM user_entitlements
      WHERE id = ?
      LIMIT 1
    `).bind(entitlementId).first<BillingEntitlementRow>(),
  ]);

  if (!confirmedOrder || !payment || !entitlement) {
    return Response.json({ error: "confirmation_persist_failed" }, { status: 500 });
  }

  return Response.json({
    ok: true,
    reused: Boolean(existingPayment),
    order: buildOrderResponse(confirmedOrder, selection.taxMode),
    payment: buildPaymentResponse(payment),
    entitlement: buildEntitlementResponse(entitlement),
  });
}

export async function handleBilling(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  if (!isTrustedInternalRequest(request, env)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = request.headers.get("X-User-Id")?.trim() || "";
  if (!userId) {
    return Response.json({ error: "missing user id" }, { status: 400 });
  }

  if (url.pathname === "/api/billing/order") {
    return handleBillingOrderCreate(request, env, userId);
  }

  if (url.pathname === "/api/billing/confirm") {
    return handleBillingConfirm(request, env, userId);
  }

  return new Response("not found", { status: 404 });
}
