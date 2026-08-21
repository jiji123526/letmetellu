import type { Env } from "../types.ts";
import {
  calculateBillingOrderExpiresAt,
  getBillingPlanCatalog,
  resolveBillingPlanSelection,
} from "../lib/billing-plans.ts";
import {
  markBillingSubscriptionCancelRequested,
  markBillingSubscriptionCanceled,
  upsertBillingSubscription,
} from "../lib/billing-subscriptions.ts";
import {
  ensureBetaGrandfatheredPlusEntitlement,
  isBetaGrandfatherAllUsersEnabled,
  readActivePlusEntitlement,
} from "../lib/plan-entitlements.ts";
import {
  persistBillingConfirmation,
  readBillingEntitlementByOrderId,
  type BillingEntitlementRow,
  type PaymentRow,
  type PendingBillingOrderRow,
} from "../lib/billing-persistence.ts";
import { isTrustedInternalRequest } from "../lib/trusted-identity.ts";

interface BillingWebhookEventRow {
  provider_event_id: string;
  provider: string;
  event_type: string;
  received_at: string;
  processed_at: string | null;
  status: string;
  failure_code: string | null;
  order_id: string | null;
  user_id: string | null;
}

interface TossBillingPrepareRow {
  id: string;
  email: string | null;
  name: string | null;
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

function buildCatalogEntryResponse(entry: ReturnType<typeof getBillingPlanCatalog>[number]) {
  return {
    plan: entry.plan,
    billing_cycle: entry.billingCycle,
    provider: entry.provider,
    amount: entry.amount,
    currency: entry.currency,
    auto_renews: entry.autoRenews,
    tax_mode: entry.taxMode,
    duration_days: entry.durationDays,
  };
}

function buildTossCustomerKey(userId: string): string {
  const normalized = userId.replace(/[^A-Za-z0-9_-]/g, "");
  return `yap-user-${normalized}`.slice(0, 50);
}

function buildTossOrderName(order: PendingBillingOrderRow): string {
  return order.billing_cycle === "yearly"
    ? "yap. Plus 365 days"
    : "yap. Plus 30 days";
}

function getTossApiAuthorizationHeader(secretKey: string): string {
  return `Basic ${btoa(`${secretKey}:`)}`;
}

function getTossApiBaseUrl(): string {
  return "https://api.tosspayments.com";
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

function isTrustedBillingWebhookRequest(request: Request, env: Env): boolean {
  if (isTrustedInternalRequest(request, env)) return true;
  const configuredSecret = env.BILLING_WEBHOOK_SECRET?.trim() || "";
  if (!configuredSecret) return false;
  return request.headers.get("X-Billing-Webhook-Secret") === configuredSecret;
}

function buildWebhookEventResponse(event: BillingWebhookEventRow) {
  return {
    provider_event_id: event.provider_event_id,
    provider: event.provider,
    event_type: event.event_type,
    received_at: event.received_at,
    processed_at: event.processed_at,
    status: event.status,
    failure_code: event.failure_code,
    order_id: event.order_id,
    user_id: event.user_id,
  };
}

async function readBillingOrderByReference(
  env: Env,
  input: { orderId?: string | null; provider?: string | null; providerOrderId?: string | null },
): Promise<PendingBillingOrderRow | null> {
  const orderId = input.orderId?.trim() || "";
  if (orderId) {
    return env.DB.prepare(`
      SELECT order_id, user_id, plan, billing_cycle, amount, currency,
             provider, provider_order_id, status, auto_renews, expires_at
      FROM billing_orders
      WHERE order_id = ?
      LIMIT 1
    `).bind(orderId).first<PendingBillingOrderRow>();
  }

  const provider = input.provider?.trim() || "";
  const providerOrderId = input.providerOrderId?.trim() || "";
  if (!provider || !providerOrderId) return null;
  return env.DB.prepare(`
    SELECT order_id, user_id, plan, billing_cycle, amount, currency,
           provider, provider_order_id, status, auto_renews, expires_at
    FROM billing_orders
    WHERE provider = ? AND provider_order_id = ?
    LIMIT 1
  `).bind(provider, providerOrderId).first<PendingBillingOrderRow>();
}

async function updateBillingWebhookEventStatus(
  env: Env,
  input: {
    providerEventId: string;
    status: "processed" | "failed";
    processedAt: string;
    failureCode?: string | null;
    orderId?: string | null;
    userId?: string | null;
  },
): Promise<BillingWebhookEventRow | null> {
  await env.DB.prepare(`
    UPDATE billing_webhook_events
    SET processed_at = ?, status = ?, failure_code = ?, order_id = ?, user_id = ?
    WHERE provider_event_id = ?
  `).bind(
    input.processedAt,
    input.status,
    input.failureCode || null,
    input.orderId || null,
    input.userId || null,
    input.providerEventId,
  ).run();

  return env.DB.prepare(`
    SELECT provider_event_id, provider, event_type, received_at, processed_at,
           status, failure_code, order_id, user_id
    FROM billing_webhook_events
    WHERE provider_event_id = ?
    LIMIT 1
  `).bind(input.providerEventId).first<BillingWebhookEventRow>();
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

async function handleBillingState(env: Env, userId: string): Promise<Response> {
  const user = await env.DB.prepare(
    "SELECT id FROM users WHERE id = ? LIMIT 1",
  ).bind(userId).first<{ id: string }>();
  if (!user) {
    return Response.json({ error: "user_not_found" }, { status: 404 });
  }

  await ensureBetaGrandfatheredPlusEntitlement(env, userId);

  const now = new Date().toISOString();
  const [activeEntitlement, latestPendingOrder] = await Promise.all([
    readActivePlusEntitlement(env, userId, now),
    env.DB.prepare(`
      SELECT order_id, user_id, plan, billing_cycle, amount, currency,
             provider, provider_order_id, status, auto_renews, expires_at
      FROM billing_orders
      WHERE user_id = ?
        AND status = 'pending'
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC, order_id DESC
      LIMIT 1
    `).bind(userId, now).first<PendingBillingOrderRow>(),
  ]);

  return Response.json({
    ok: true,
    plans: getBillingPlanCatalog().map((entry) => buildCatalogEntryResponse(entry)),
    active_entitlement: activeEntitlement
      ? {
          id: activeEntitlement.id,
          plan: activeEntitlement.plan,
          status: activeEntitlement.status,
          provider: activeEntitlement.provider,
          starts_at: activeEntitlement.starts_at,
          ends_at: activeEntitlement.ends_at,
          source_type: activeEntitlement.source_type,
          provider_customer_id: activeEntitlement.provider_customer_id,
          provider_subscription_id: activeEntitlement.provider_subscription_id,
          auto_renews: Number(activeEntitlement.auto_renews) === 1,
        }
      : null,
    latest_pending_order: latestPendingOrder
      ? buildOrderResponse(latestPendingOrder, "vat_exclusive")
      : null,
  });
}

async function handleBillingTossPrepare(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json() as { order_id?: unknown };
  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
  if (!orderId) {
    return Response.json({ error: "missing_order_id" }, { status: 400 });
  }

  const [order, user] = await Promise.all([
    env.DB.prepare(`
      SELECT order_id, user_id, plan, billing_cycle, amount, currency,
             provider, provider_order_id, status, auto_renews, expires_at
      FROM billing_orders
      WHERE order_id = ? AND user_id = ?
      LIMIT 1
    `).bind(orderId, userId).first<PendingBillingOrderRow>(),
    env.DB.prepare(`
      SELECT id, email, name
      FROM users
      WHERE id = ?
      LIMIT 1
    `).bind(userId).first<TossBillingPrepareRow>(),
  ]);
  if (!order || !user) {
    return Response.json({ error: "order_not_found" }, { status: 404 });
  }
  if (order.provider !== "toss_autobilling") {
    return Response.json({ error: "unsupported_provider" }, { status: 409 });
  }
  if (order.status !== "pending") {
    return Response.json({ error: "order_not_pending" }, { status: 409 });
  }

  const now = new Date().toISOString();
  if (order.expires_at && order.expires_at <= now) {
    return Response.json({ error: "order_expired" }, { status: 409 });
  }

  return Response.json({
    ok: true,
    order: buildOrderResponse(order, "vat_exclusive"),
    checkout: {
      provider: "toss_autobilling",
      customer_key: buildTossCustomerKey(user.id),
      customer_email: user.email,
      customer_name: user.name,
      order_name: buildTossOrderName(order),
      success_url: `${env.APP_ORIGIN.replace(/\/$/, "")}/billing/callback/toss/success?order_id=${encodeURIComponent(order.order_id)}`,
      fail_url: `${env.APP_ORIGIN.replace(/\/$/, "")}/billing/callback/toss/fail?order_id=${encodeURIComponent(order.order_id)}`,
    },
  });
}

async function handleBillingTossConfirm(request: Request, env: Env, userId: string): Promise<Response> {
  const secretKey = env.TOSS_PAYMENTS_SECRET_KEY?.trim() || "";
  if (!secretKey) {
    return Response.json({ error: "billing_provider_not_configured" }, { status: 503 });
  }

  const body = await request.json() as {
    order_id?: unknown;
    auth_key?: unknown;
    customer_key?: unknown;
  };
  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
  const authKey = typeof body.auth_key === "string" ? body.auth_key.trim() : "";
  const customerKey = typeof body.customer_key === "string" ? body.customer_key.trim() : "";
  if (!orderId || !authKey || !customerKey) {
    return Response.json({ error: "invalid_toss_confirmation_payload" }, { status: 400 });
  }

  const [order, user] = await Promise.all([
    env.DB.prepare(`
      SELECT order_id, user_id, plan, billing_cycle, amount, currency,
             provider, provider_order_id, status, auto_renews, expires_at
      FROM billing_orders
      WHERE order_id = ? AND user_id = ?
      LIMIT 1
    `).bind(orderId, userId).first<PendingBillingOrderRow>(),
    env.DB.prepare(`
      SELECT id, email, name
      FROM users
      WHERE id = ?
      LIMIT 1
    `).bind(userId).first<TossBillingPrepareRow>(),
  ]);
  if (!order || !user) {
    return Response.json({ error: "order_not_found" }, { status: 404 });
  }
  if (order.provider !== "toss_autobilling") {
    return Response.json({ error: "unsupported_provider" }, { status: 409 });
  }
  if (customerKey !== buildTossCustomerKey(userId)) {
    return Response.json({ error: "customer_key_mismatch" }, { status: 409 });
  }

  const authHeader = getTossApiAuthorizationHeader(secretKey);
  const issueResponse = await fetch(`${getTossApiBaseUrl()}/v1/billing/authorizations/issue`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      authKey,
      customerKey,
    }),
  });
  const issueData = await issueResponse.json().catch(() => ({})) as {
    billingKey?: string;
    customerKey?: string;
  };
  if (!issueResponse.ok || !issueData.billingKey) {
    return Response.json({
      error: "toss_billing_key_issue_failed",
      provider_status: issueResponse.status,
    }, { status: 502 });
  }

  const chargeResponse = await fetch(`${getTossApiBaseUrl()}/v1/billing/${encodeURIComponent(issueData.billingKey)}`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customerKey,
      amount: order.amount,
      orderId: order.order_id,
      orderName: buildTossOrderName(order),
      customerEmail: user.email,
      customerName: user.name,
    }),
  });
  const chargeData = await chargeResponse.json().catch(() => ({})) as {
    paymentKey?: string;
    orderId?: string;
    totalAmount?: number;
    method?: string;
    approvedAt?: string;
    customerKey?: string;
    mId?: string;
  };
  if (!chargeResponse.ok || !chargeData.paymentKey || !Number.isInteger(chargeData.totalAmount)) {
    return Response.json({
      error: "toss_first_charge_failed",
      provider_status: chargeResponse.status,
    }, { status: 502 });
  }

  const approvedAt = typeof chargeData.approvedAt === "string" && isIsoTimestamp(chargeData.approvedAt)
    ? new Date(chargeData.approvedAt).toISOString()
    : new Date().toISOString();

  const persistenceResponse = await persistBillingConfirmation({
    env,
    userId,
    order,
    provider: "toss_autobilling",
    providerOrderId: chargeData.orderId || order.order_id,
    providerPaymentId: chargeData.paymentKey,
    amount: Number(chargeData.totalAmount),
    currency: order.currency,
    paymentMethod: chargeData.method || "card",
    providerCustomerId: chargeData.customerKey || customerKey,
    providerSubscriptionId: null,
    approvedAt,
  });
  if (!persistenceResponse.ok) {
    return Response.json({ error: persistenceResponse.error }, { status: persistenceResponse.status });
  }

  await upsertBillingSubscription(env, {
    userId,
    provider: "toss_autobilling",
    plan: order.plan,
    billingCycle: order.billing_cycle,
    providerCustomerKey: chargeData.customerKey || customerKey,
    billingKey: issueData.billingKey,
    currentPeriodOrderId: order.order_id,
    currentPeriodStartedAt: persistenceResponse.entitlement.starts_at,
    currentPeriodEndsAt: persistenceResponse.entitlement.ends_at || approvedAt,
    lastChargedAt: approvedAt,
  });

  return Response.json({
    ok: true,
    reused: persistenceResponse.reusedPayment,
    order: buildOrderResponse(persistenceResponse.order, persistenceResponse.selection.taxMode),
    payment: buildPaymentResponse(persistenceResponse.payment),
    entitlement: buildEntitlementResponse(persistenceResponse.entitlement),
    provider_flow: {
      provider: "toss_autobilling",
      billing_key_issued: true,
      renewal_storage_pending: false,
      merchant_id: chargeData.mId || null,
    },
  });
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

  const persisted = await persistBillingConfirmation({
    env,
    userId,
    order,
    provider,
    providerOrderId,
    providerPaymentId,
    amount,
    currency,
    paymentMethod,
    providerCustomerId,
    providerSubscriptionId,
    approvedAt,
  });
  if (!persisted.ok) {
    return Response.json({ error: persisted.error }, { status: persisted.status });
  }

  return Response.json({
    ok: true,
    reused: persisted.reusedPayment,
    order: buildOrderResponse(persisted.order, persisted.selection.taxMode),
    payment: buildPaymentResponse(persisted.payment),
    entitlement: buildEntitlementResponse(persisted.entitlement),
  });
}

async function handleBillingWebhook(request: Request, env: Env): Promise<Response> {
  if (!isTrustedBillingWebhookRequest(request, env)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json() as {
    provider_event_id?: unknown;
    provider?: unknown;
    event_type?: unknown;
    order_id?: unknown;
    provider_order_id?: unknown;
    provider_payment_id?: unknown;
    provider_subscription_id?: unknown;
    effective_at?: unknown;
  };

  const providerEventId = typeof body.provider_event_id === "string" ? body.provider_event_id.trim() : "";
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const eventType = typeof body.event_type === "string" ? body.event_type.trim() : "";
  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
  const providerOrderId = typeof body.provider_order_id === "string" ? body.provider_order_id.trim() : "";
  const providerPaymentId = typeof body.provider_payment_id === "string" ? body.provider_payment_id.trim() : "";
  const providerSubscriptionId = typeof body.provider_subscription_id === "string"
    ? body.provider_subscription_id.trim()
    : "";
  const effectiveAtInput = typeof body.effective_at === "string" ? body.effective_at.trim() : "";
  const effectiveAt = effectiveAtInput && isIsoTimestamp(effectiveAtInput)
    ? new Date(effectiveAtInput).toISOString()
    : new Date().toISOString();

  if (!providerEventId || !provider || !eventType) {
    return Response.json({ error: "invalid_webhook_payload" }, { status: 400 });
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO billing_webhook_events (
      provider_event_id, provider, event_type, processed_at, status,
      failure_code, order_id, user_id
    ) VALUES (?, ?, ?, NULL, 'pending', NULL, NULL, NULL)
  `).bind(
    providerEventId,
    provider,
    eventType,
  ).run();

  const existingEvent = await env.DB.prepare(`
    SELECT provider_event_id, provider, event_type, received_at, processed_at,
           status, failure_code, order_id, user_id
    FROM billing_webhook_events
    WHERE provider_event_id = ?
    LIMIT 1
  `).bind(providerEventId).first<BillingWebhookEventRow>();

  if (!existingEvent) {
    return Response.json({ error: "webhook_event_persist_failed" }, { status: 500 });
  }

  if (existingEvent.status === "processed") {
    return Response.json({
      ok: true,
      reused: true,
      event: buildWebhookEventResponse(existingEvent),
    });
  }

  const order = await readBillingOrderByReference(env, {
    orderId,
    provider,
    providerOrderId,
  });
  const processedAt = new Date().toISOString();
  if (!order?.order_id || !order.user_id) {
    const failedEvent = await updateBillingWebhookEventStatus(env, {
      providerEventId,
      status: "failed",
      processedAt,
      failureCode: "order_not_found",
    });
    return Response.json({
      error: "order_not_found",
      event: failedEvent ? buildWebhookEventResponse(failedEvent) : null,
    }, { status: 404 });
  }

  let payment: PaymentRow | null = null;
  let entitlement: BillingEntitlementRow | null = null;

  if (eventType === "subscription.canceled") {
    await env.DB.prepare(`
      UPDATE billing_orders
      SET status = 'non_renewing', provider_order_id = COALESCE(provider_order_id, ?), updated_at = ?
      WHERE order_id = ?
    `).bind(
      providerOrderId || null,
      processedAt,
      order.order_id,
    ).run();

    await env.DB.prepare(`
      UPDATE user_entitlements
      SET auto_renews = 0,
          provider_subscription_id = COALESCE(provider_subscription_id, ?),
          updated_at = ?
      WHERE source_order_id = ? AND source_type = 'billing'
    `).bind(
      providerSubscriptionId || null,
      processedAt,
      order.order_id,
    ).run();
    await markBillingSubscriptionCancelRequested(env, order.order_id, effectiveAt, providerSubscriptionId || null);
  } else if (eventType === "payment.canceled" || eventType === "payment.refunded") {
    const paymentStatus = eventType === "payment.refunded" ? "refunded" : "canceled";
    const orderStatus = eventType === "payment.refunded" ? "refunded" : "canceled";
    if (providerPaymentId) {
      await env.DB.prepare(`
        UPDATE payments
        SET status = ?, canceled_at = COALESCE(canceled_at, ?), updated_at = ?
        WHERE provider_payment_id = ?
      `).bind(
        paymentStatus,
        effectiveAt,
        processedAt,
        providerPaymentId,
      ).run();
    } else {
      await env.DB.prepare(`
        UPDATE payments
        SET status = ?, canceled_at = COALESCE(canceled_at, ?), updated_at = ?
        WHERE order_id = ?
      `).bind(
        paymentStatus,
        effectiveAt,
        processedAt,
        order.order_id,
      ).run();
    }

    await env.DB.prepare(`
      UPDATE billing_orders
      SET status = ?, provider_order_id = COALESCE(provider_order_id, ?), updated_at = ?
      WHERE order_id = ?
    `).bind(
      orderStatus,
      providerOrderId || null,
      processedAt,
      order.order_id,
    ).run();

    await env.DB.prepare(`
      UPDATE user_entitlements
      SET status = 'ended',
          ends_at = CASE
            WHEN ends_at IS NULL OR ends_at > ? THEN ?
            ELSE ends_at
          END,
          auto_renews = 0,
          updated_at = ?
      WHERE source_order_id = ? AND source_type = 'billing'
    `).bind(
      effectiveAt,
      effectiveAt,
      processedAt,
      order.order_id,
    ).run();
    await markBillingSubscriptionCanceled(env, order.order_id, effectiveAt);
  } else {
    const failedEvent = await updateBillingWebhookEventStatus(env, {
      providerEventId,
      status: "failed",
      processedAt,
      failureCode: "unsupported_event_type",
      orderId: order.order_id,
      userId: order.user_id,
    });
    return Response.json({
      error: "unsupported_event_type",
      event: failedEvent ? buildWebhookEventResponse(failedEvent) : null,
    }, { status: 400 });
  }

  const [processedEvent, currentOrder, currentPayment, currentEntitlement] = await Promise.all([
    updateBillingWebhookEventStatus(env, {
      providerEventId,
      status: "processed",
      processedAt,
      orderId: order.order_id,
      userId: order.user_id,
    }),
    readBillingOrderByReference(env, { orderId: order.order_id }),
    providerPaymentId
      ? env.DB.prepare(`
          SELECT provider_payment_id, order_id, user_id, provider, method,
                 amount, currency, status, approved_at, canceled_at
          FROM payments
          WHERE provider_payment_id = ?
          LIMIT 1
        `).bind(providerPaymentId).first<PaymentRow>()
      : env.DB.prepare(`
          SELECT provider_payment_id, order_id, user_id, provider, method,
                 amount, currency, status, approved_at, canceled_at
          FROM payments
          WHERE order_id = ?
          ORDER BY approved_at DESC, created_at DESC
          LIMIT 1
        `).bind(order.order_id).first<PaymentRow>(),
    readBillingEntitlementByOrderId(env, order.order_id),
  ]);

  payment = currentPayment;
  entitlement = currentEntitlement;

  return Response.json({
    ok: true,
    reused: false,
    event: processedEvent ? buildWebhookEventResponse(processedEvent) : null,
    order: currentOrder ? buildOrderResponse(currentOrder, "vat_exclusive") : null,
    payment: payment ? buildPaymentResponse(payment) : null,
    entitlement: entitlement ? buildEntitlementResponse(entitlement) : null,
  });
}

export async function handleBilling(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/billing/state") {
    if (request.method !== "GET") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }
    if (!isTrustedInternalRequest(request, env)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const userId = request.headers.get("X-User-Id")?.trim() || "";
    if (!userId) {
      return Response.json({ error: "missing user id" }, { status: 400 });
    }
    return handleBillingState(env, userId);
  }

  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  if (url.pathname === "/api/billing/webhook") {
    return handleBillingWebhook(request, env);
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

  if (url.pathname === "/api/billing/toss/prepare") {
    return handleBillingTossPrepare(request, env, userId);
  }

  if (url.pathname === "/api/billing/toss/confirm") {
    return handleBillingTossConfirm(request, env, userId);
  }

  if (url.pathname === "/api/billing/confirm") {
    return handleBillingConfirm(request, env, userId);
  }

  return new Response("not found", { status: 404 });
}
