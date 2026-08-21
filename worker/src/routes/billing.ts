import type { Env } from "../types.ts";
import {
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
  plan: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  provider: string;
  status: string;
  auto_renews: number;
  expires_at: string | null;
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
    status: order.status,
    auto_renews: Number(order.auto_renews) === 1,
    expires_at: order.expires_at,
    tax_mode: taxMode,
  };
}

export async function handleBilling(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/billing/order") {
    return new Response("not found", { status: 404 });
  }

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
           provider, status, auto_renews, expires_at
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
      status: "pending",
      auto_renews: selection.autoRenews ? 1 : 0,
      expires_at: expiresAt,
    }, selection.taxMode),
  }, { status: 201 });
}
