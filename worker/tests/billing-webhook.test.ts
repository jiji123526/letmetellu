import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handleBilling } from "../src/routes/billing.ts";

const webhookClaimsMigrationSource = readFileSync(
  new URL("../migrations/0059_billing_webhook_claims.sql", import.meta.url),
  "utf8",
);
const billingRouteSource = readFileSync(
  new URL("../src/routes/billing.ts", import.meta.url),
  "utf8",
);
const billingAuditSource = readFileSync(
  new URL("../scripts/audit-billing-reconciliation.sql", import.meta.url),
  "utf8",
);

function createWebhookRequest(body: Record<string, unknown>, headers?: HeadersInit) {
  return new Request("https://api.example.test/api/billing/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createMockEnv(options?: {
  event?: Record<string, unknown> | null;
  order?: Record<string, unknown> | null;
  payment?: Record<string, unknown> | null;
  entitlement?: Record<string, unknown> | null;
  webhookSecret?: string | undefined;
  channels?: Array<Record<string, unknown>>;
}) {
  const runQueries: string[] = [];
  const state = {
    event: options?.event || null,
    order: options?.order || null,
    payment: options?.payment || null,
    entitlement: options?.entitlement || null,
    channels: options?.channels || [
      { id: "channel-new", last_activity_at: "2026-08-20T00:00:00.000Z" },
      { id: "channel-old", last_activity_at: "2026-08-19T00:00:00.000Z" },
    ],
    retentionChoice: null as null | {
      retained_channel_id: string;
      effective_at: string;
    },
  };

  const env = {
    INTERNAL_SECRET: "internal-secret",
    BILLING_WEBHOOK_SECRET: options?.webhookSecret,
    DB: {
      prepare(query: string) {
        return {
          bind(...params: unknown[]) {
            return {
              async first<T>() {
                if (query.includes("FROM billing_webhook_events")) {
                  return state.event as T | null;
                }
                if (query.includes("FROM billing_orders") && query.includes("WHERE order_id = ?")) {
                  if (state.order && params[0] === (state.order as { order_id?: string }).order_id) {
                    return state.order as T;
                  }
                  return null;
                }
                if (query.includes("FROM billing_orders") && query.includes("WHERE provider = ? AND provider_order_id = ?")) {
                  if (
                    state.order
                    && params[0] === (state.order as { provider?: string }).provider
                    && params[1] === (state.order as { provider_order_id?: string }).provider_order_id
                  ) {
                    return state.order as T;
                  }
                  return null;
                }
                if (query.includes("FROM payments") && query.includes("WHERE provider_payment_id = ?")) {
                  if (state.payment && params[0] === (state.payment as { provider_payment_id?: string }).provider_payment_id) {
                    return state.payment as T;
                  }
                  return null;
                }
                if (query.includes("FROM payments") && query.includes("WHERE order_id = ?")) {
                  if (state.payment && params[0] === (state.payment as { order_id?: string }).order_id) {
                    return state.payment as T;
                  }
                  return null;
                }
                if (query.includes("FROM user_entitlements") && query.includes("WHERE source_order_id = ?")) {
                  if (state.entitlement && params[0] === (state.entitlement as { source_order_id?: string }).source_order_id) {
                    return state.entitlement as T;
                  }
                  return null;
                }
                if (query.includes("FROM user_entitlements") && query.includes("WHERE user_id = ?")) {
                  if ((state.entitlement as { status?: string } | null)?.status === "active") {
                    return state.entitlement as T;
                  }
                  return null;
                }
                if (query.includes("FROM user_channel_retention_choices")) {
                  return state.retentionChoice as T | null;
                }
                return null;
              },
              async run() {
                runQueries.push(query);

                if (query.includes("INSERT OR IGNORE INTO billing_webhook_events")) {
                  if (!state.event) {
                    state.event = {
                      provider_event_id: params[0],
                      provider: params[1],
                      event_type: params[2],
                      received_at: "2026-08-21T00:00:00.000Z",
                      processed_at: null,
                      status: "pending",
                      failure_code: null,
                      order_id: null,
                      user_id: null,
                    };
                  }
                } else if (query.includes("SET status = 'processing'")) {
                  const currentStatus = (state.event as { status?: string } | null)?.status;
                  const processingStartedAt = (state.event as { processing_started_at?: string | null } | null)
                    ?.processing_started_at;
                  const staleProcessing = currentStatus === "processing"
                    && (!processingStartedAt || processingStartedAt < String(params[4]));
                  if (currentStatus !== "pending" && currentStatus !== "failed" && !staleProcessing) {
                    return { success: true, meta: { changes: 0 } };
                  }
                  state.event = {
                    ...(state.event || {}),
                    status: "processing",
                    processing_started_at: params[0],
                    processed_at: null,
                    failure_code: null,
                    attempt_count: Number((state.event as { attempt_count?: number } | null)?.attempt_count || 0) + 1,
                  };
                } else if (query.includes("UPDATE billing_webhook_events")) {
                  state.event = {
                    ...(state.event || {}),
                    processed_at: params[0],
                    status: params[1],
                    failure_code: params[2],
                    order_id: params[3],
                    user_id: params[4],
                  };
                } else if (query.includes("INSERT INTO user_channel_retention_choices")) {
                  state.retentionChoice = {
                    retained_channel_id: String(params[1]),
                    effective_at: String(params[2]),
                  };
                } else if (query.includes("UPDATE billing_orders") && query.includes("SET status = 'non_renewing'")) {
                  state.order = {
                    ...(state.order || {}),
                    status: "non_renewing",
                    provider_order_id: (state.order as { provider_order_id?: string | null } | null)?.provider_order_id || params[0],
                  };
                } else if (query.includes("UPDATE billing_orders")) {
                  state.order = {
                    ...(state.order || {}),
                    status: params[0],
                    provider_order_id: (state.order as { provider_order_id?: string | null } | null)?.provider_order_id || params[1],
                  };
                } else if (query.includes("UPDATE payments")) {
                  state.payment = {
                    ...(state.payment || {}),
                    status: params[0],
                    canceled_at: (state.payment as { canceled_at?: string | null } | null)?.canceled_at || params[1],
                  };
                } else if (query.includes("provider_subscription_id = COALESCE")) {
                  state.entitlement = {
                    ...(state.entitlement || {}),
                    auto_renews: 0,
                    provider_subscription_id: (state.entitlement as { provider_subscription_id?: string | null } | null)?.provider_subscription_id || params[0],
                  };
                } else if (query.includes("SET status = 'ended'")) {
                  state.entitlement = {
                    ...(state.entitlement || {}),
                    status: "ended",
                    ends_at: params[1],
                    auto_renews: 0,
                  };
                }

                return { success: true, meta: { changes: 1 } };
              },
              async all<T>() {
                if (query.includes("FROM channels")) {
                  return { results: state.channels as T[] };
                }
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    },
  };

  return { env, runQueries, state };
}

test("billing webhook records subscription cancellation without removing current access immediately", async () => {
  const fixture = createMockEnv({
    order: {
      order_id: "order-1",
      user_id: "user-1",
      plan: "plus",
      billing_cycle: "monthly",
      amount: 2900,
      currency: "KRW",
      provider: "toss_autobilling",
      provider_order_id: "provider-order-1",
      status: "confirmed",
      auto_renews: 1,
      expires_at: "2026-09-20T00:00:00.000Z",
    },
    payment: {
      provider_payment_id: "payment-1",
      order_id: "order-1",
      user_id: "user-1",
      provider: "toss_autobilling",
      method: "card",
      amount: 2900,
      currency: "KRW",
      status: "paid",
      approved_at: "2026-08-21T00:00:00.000Z",
      canceled_at: null,
    },
    entitlement: {
      id: "billing-order:order-1",
      user_id: "user-1",
      provider: "toss_autobilling",
      plan: "plus",
      status: "active",
      starts_at: "2026-08-21T00:00:00.000Z",
      ends_at: "2026-09-20T00:00:00.000Z",
      source_order_id: "order-1",
      source_type: "billing",
      provider_customer_id: "customer-1",
      provider_subscription_id: null,
      auto_renews: 1,
    },
  });

  const response = await handleBilling(createWebhookRequest(
    {
      provider_event_id: "event-1",
      provider: "toss_autobilling",
      event_type: "subscription.canceled",
      order_id: "order-1",
      provider_order_id: "provider-order-1",
      provider_subscription_id: "subscription-1",
      effective_at: "2026-08-25T00:00:00.000Z",
    },
    {
      "X-Internal-Token": fixture.env.INTERNAL_SECRET,
    },
  ), fixture.env as never);

  assert.equal(response.status, 200);
  const data = await response.json() as Record<string, unknown>;
  assert.equal(data.ok, true);
  assert.equal(data.reused, false);
  assert.deepEqual(data.order, {
    order_id: "order-1",
    plan: "plus",
    billing_cycle: "monthly",
    amount: 2900,
    currency: "KRW",
    provider: "toss_autobilling",
    provider_order_id: "provider-order-1",
    status: "non_renewing",
    auto_renews: true,
    expires_at: "2026-09-20T00:00:00.000Z",
    tax_mode: "vat_exclusive",
  });
  assert.deepEqual(data.entitlement, {
    id: "billing-order:order-1",
    plan: "plus",
    status: "active",
    starts_at: "2026-08-21T00:00:00.000Z",
    ends_at: "2026-09-20T00:00:00.000Z",
    source_type: "billing",
    provider_customer_id: "customer-1",
    provider_subscription_id: "subscription-1",
    auto_renews: false,
  });
  assert.deepEqual(data.event, {
    provider_event_id: "event-1",
    provider: "toss_autobilling",
    event_type: "subscription.canceled",
    received_at: "2026-08-21T00:00:00.000Z",
    processed_at: (data.event as { processed_at: string }).processed_at,
    status: "processed",
    failure_code: null,
    order_id: "order-1",
    user_id: "user-1",
  });
  assert.match(fixture.runQueries.join("\n"), /INSERT OR IGNORE INTO billing_webhook_events/);
  assert.match(fixture.runQueries.join("\n"), /SET status = 'non_renewing'/);
  assert.deepEqual(fixture.state.retentionChoice, {
    retained_channel_id: "channel-new",
    effective_at: "2026-09-20T00:00:00.000Z",
  });
});

test("billing webhook revokes entitlement on refund reconciliation", async () => {
  const fixture = createMockEnv({
    order: {
      order_id: "order-1",
      user_id: "user-1",
      plan: "plus",
      billing_cycle: "yearly",
      amount: 17000,
      currency: "KRW",
      provider: "toss_autobilling",
      provider_order_id: "provider-order-1",
      status: "confirmed",
      auto_renews: 1,
      expires_at: "2027-08-21T00:00:00.000Z",
    },
    payment: {
      provider_payment_id: "payment-1",
      order_id: "order-1",
      user_id: "user-1",
      provider: "toss_autobilling",
      method: "card",
      amount: 17000,
      currency: "KRW",
      status: "paid",
      approved_at: "2026-08-21T00:00:00.000Z",
      canceled_at: null,
    },
    entitlement: {
      id: "billing-order:order-1",
      user_id: "user-1",
      provider: "toss_autobilling",
      plan: "plus",
      status: "active",
      starts_at: "2026-08-21T00:00:00.000Z",
      ends_at: "2027-08-21T00:00:00.000Z",
      source_order_id: "order-1",
      source_type: "billing",
      provider_customer_id: "customer-1",
      provider_subscription_id: "subscription-1",
      auto_renews: 1,
    },
  });

  const response = await handleBilling(createWebhookRequest(
    {
      provider_event_id: "event-2",
      provider: "toss_autobilling",
      event_type: "payment.refunded",
      order_id: "order-1",
      provider_order_id: "provider-order-1",
      provider_payment_id: "payment-1",
      effective_at: "2026-08-22T00:00:00.000Z",
    },
    {
      "X-Internal-Token": fixture.env.INTERNAL_SECRET,
    },
  ), fixture.env as never);

  assert.equal(response.status, 200);
  const data = await response.json() as Record<string, unknown>;
  assert.equal(data.ok, true);
  assert.deepEqual(data.payment, {
    provider_payment_id: "payment-1",
    provider: "toss_autobilling",
    method: "card",
    amount: 17000,
    currency: "KRW",
    status: "refunded",
    approved_at: "2026-08-21T00:00:00.000Z",
    canceled_at: "2026-08-22T00:00:00.000Z",
  });
  assert.deepEqual(data.entitlement, {
    id: "billing-order:order-1",
    plan: "plus",
    status: "ended",
    starts_at: "2026-08-21T00:00:00.000Z",
    ends_at: "2026-08-22T00:00:00.000Z",
    source_type: "billing",
    provider_customer_id: "customer-1",
    provider_subscription_id: "subscription-1",
    auto_renews: false,
  });
  assert.equal((data.order as { status: string }).status, "refunded");
  assert.deepEqual(fixture.state.retentionChoice, {
    retained_channel_id: "channel-new",
    effective_at: "2026-08-22T00:00:00.000Z",
  });
});

test("billing webhook returns a reused response for an already processed provider event", async () => {
  const fixture = createMockEnv({
    event: {
      provider_event_id: "event-3",
      provider: "toss_autobilling",
      event_type: "payment.refunded",
      received_at: "2026-08-21T00:00:00.000Z",
      processed_at: "2026-08-21T00:05:00.000Z",
      status: "processed",
      failure_code: null,
      order_id: "order-1",
      user_id: "user-1",
    },
  });

  const response = await handleBilling(createWebhookRequest(
    {
      provider_event_id: "event-3",
      provider: "toss_autobilling",
      event_type: "payment.refunded",
      order_id: "order-1",
    },
    {
      "X-Internal-Token": fixture.env.INTERNAL_SECRET,
    },
  ), fixture.env as never);

  assert.equal(response.status, 200);
  const data = await response.json() as Record<string, unknown>;
  assert.equal(data.ok, true);
  assert.equal(data.reused, true);
  assert.deepEqual(data.event, fixture.state.event);
  assert.equal(fixture.runQueries.length, 1);
});

test("billing webhook does not concurrently process an event with a fresh claim", async () => {
  const fixture = createMockEnv({
    event: {
      provider_event_id: "event-processing",
      provider: "toss_autobilling",
      event_type: "payment.refunded",
      received_at: new Date().toISOString(),
      processed_at: null,
      processing_started_at: new Date().toISOString(),
      attempt_count: 1,
      status: "processing",
      failure_code: null,
      order_id: null,
      user_id: null,
    },
  });

  const response = await handleBilling(createWebhookRequest(
    {
      provider_event_id: "event-processing",
      provider: "toss_autobilling",
      event_type: "payment.refunded",
      order_id: "order-1",
    },
    { "X-Internal-Token": fixture.env.INTERNAL_SECRET },
  ), fixture.env as never);

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "5");
  const data = await response.json() as Record<string, unknown>;
  assert.equal(data.error, "webhook_event_processing");
  assert.equal(data.retryable, true);
  assert.doesNotMatch(fixture.runQueries.join("\n"), /UPDATE payments/);
});

test("billing webhook rejects reuse of an event id for another event identity", async () => {
  const fixture = createMockEnv({
    event: {
      provider_event_id: "event-conflict",
      provider: "toss_autobilling",
      event_type: "subscription.canceled",
      received_at: "2026-08-21T00:00:00.000Z",
      processed_at: null,
      processing_started_at: null,
      attempt_count: 0,
      status: "pending",
      failure_code: null,
      order_id: null,
      user_id: null,
    },
  });

  const response = await handleBilling(createWebhookRequest(
    {
      provider_event_id: "event-conflict",
      provider: "toss_autobilling",
      event_type: "payment.refunded",
      order_id: "order-1",
    },
    { "X-Internal-Token": fixture.env.INTERNAL_SECRET },
  ), fixture.env as never);

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "webhook_event_identity_conflict",
    event: {
      provider_event_id: "event-conflict",
      provider: "toss_autobilling",
      event_type: "subscription.canceled",
      received_at: "2026-08-21T00:00:00.000Z",
      processed_at: null,
      status: "pending",
      failure_code: null,
      order_id: null,
      user_id: null,
    },
  });
  assert.equal(fixture.runQueries.length, 1);
});

test("billing webhook claims are recoverable and reconciliation remains auditable", () => {
  assert.match(webhookClaimsMigrationSource, /processing_started_at TEXT/);
  assert.match(webhookClaimsMigrationSource, /attempt_count INTEGER NOT NULL DEFAULT 0/);
  assert.match(billingRouteSource, /status = 'processing'/);
  assert.match(billingRouteSource, /processing_started_at < \?/);
  assert.match(billingRouteSource, /attempt_count = attempt_count \+ 1/);
  assert.match(billingAuditSource, /stuck_webhook_events/);
  assert.match(billingAuditSource, /terminal_payment_active_entitlements/);
  assert.match(billingAuditSource, /nonrenewing_subscription_autorenew_entitlements/);
});
