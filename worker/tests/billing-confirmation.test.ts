import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handleBilling } from "../src/routes/billing.ts";

const nextBillingConfirmProxySource = readFileSync(
  new URL("../../src/app/api/billing/confirm/route.ts", import.meta.url),
  "utf8",
);

function createConfirmationRequest(body: Record<string, unknown>, headers?: HeadersInit) {
  return new Request("https://api.example.test/api/billing/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createMockEnv(options?: {
  order?: Record<string, unknown> | null;
  payment?: Record<string, unknown> | null;
  entitlement?: Record<string, unknown> | null;
}) {
  const queries: string[] = [];
  const boundParams: unknown[][] = [];
  const runQueries: string[] = [];

  const state = {
    order: options?.order || null,
    payment: options?.payment || null,
    entitlement: options?.entitlement || null,
  };

  const env = {
    INTERNAL_SECRET: "internal-secret",
    DB: {
      prepare(query: string) {
        queries.push(query);
        return {
          bind(...params: unknown[]) {
            boundParams.push(params);
            return {
              async first<T>() {
                if (query.includes("FROM billing_orders") && query.includes("WHERE order_id = ? AND user_id = ?")) {
                  return state.order as T | null;
                }
                if (query.includes("FROM payments") && query.includes("WHERE provider_payment_id = ?")) {
                  return state.payment as T | null;
                }
                if (query.includes("FROM user_entitlements") && query.includes("WHERE id = ?")) {
                  return state.entitlement as T | null;
                }
                return null;
              },
              async run() {
                runQueries.push(query);

                if (query.includes("INSERT INTO payments")) {
                  state.payment = {
                    provider_payment_id: params[0],
                    order_id: params[1],
                    user_id: params[2],
                    provider: params[3],
                    method: params[4],
                    amount: params[5],
                    currency: params[6],
                    status: "paid",
                    approved_at: params[7],
                    canceled_at: null,
                  };
                } else if (query.includes("UPDATE billing_orders")) {
                  state.order = {
                    ...(state.order || {}),
                    provider_order_id: params[0],
                    status: "confirmed",
                  };
                } else if (query.includes("INSERT OR IGNORE INTO user_entitlements")) {
                  state.entitlement = {
                    id: params[0],
                    user_id: params[1],
                    provider: params[2],
                    plan: params[3],
                    status: "active",
                    starts_at: params[4],
                    ends_at: params[5],
                    source_order_id: params[6],
                    source_type: "billing",
                    provider_customer_id: params[7],
                    provider_subscription_id: params[8],
                    auto_renews: params[9],
                  };
                }

                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  return { env, queries, boundParams, runQueries };
}

test("billing confirmation persists payment and entitlement from a validated order", async () => {
  const fixture = createMockEnv({
    order: {
      order_id: "order-1",
      user_id: "user-1",
      plan: "plus",
      billing_cycle: "monthly",
      amount: 2900,
      currency: "KRW",
      provider: "toss_autobilling",
      provider_order_id: null,
      status: "pending",
      auto_renews: 1,
      expires_at: "2099-08-21T00:30:00.000Z",
    },
  });

  const response = await handleBilling(createConfirmationRequest(
    {
      order_id: "order-1",
      provider: "toss_autobilling",
      provider_order_id: "provider-order-1",
      provider_payment_id: "payment-1",
      amount: 2900,
      currency: "krw",
      payment_method: "card",
      provider_customer_id: "customer-1",
      provider_subscription_id: "subscription-1",
      approved_at: "2026-08-21T00:00:00.000Z",
    },
    {
      "X-Internal-Token": fixture.env.INTERNAL_SECRET,
      "X-User-Id": "user-1",
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
    status: "confirmed",
    auto_renews: true,
    expires_at: "2099-08-21T00:30:00.000Z",
    tax_mode: "vat_exclusive",
  });
  assert.deepEqual(data.payment, {
    provider_payment_id: "payment-1",
    provider: "toss_autobilling",
    method: "card",
    amount: 2900,
    currency: "KRW",
    status: "paid",
    approved_at: "2026-08-21T00:00:00.000Z",
    canceled_at: null,
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
    auto_renews: true,
  });
  assert.match(fixture.runQueries.join("\n"), /INSERT INTO payments/);
  assert.match(fixture.runQueries.join("\n"), /UPDATE billing_orders/);
  assert.match(fixture.runQueries.join("\n"), /INSERT OR IGNORE INTO user_entitlements/);
});

test("billing confirmation rejects mismatched provider-authoritative values", async () => {
  const fixture = createMockEnv({
    order: {
      order_id: "order-1",
      user_id: "user-1",
      plan: "plus",
      billing_cycle: "monthly",
      amount: 2900,
      currency: "KRW",
      provider: "toss_autobilling",
      provider_order_id: null,
      status: "pending",
      auto_renews: 1,
      expires_at: "2099-08-21T00:30:00.000Z",
    },
  });

  const response = await handleBilling(createConfirmationRequest(
    {
      order_id: "order-1",
      provider: "toss_autobilling",
      provider_order_id: "provider-order-1",
      provider_payment_id: "payment-1",
      amount: 3000,
      currency: "KRW",
    },
    {
      "X-Internal-Token": fixture.env.INTERNAL_SECRET,
      "X-User-Id": "user-1",
    },
  ), fixture.env as never);

  assert.equal(response.status, 409);
  const data = await response.json() as Record<string, unknown>;
  assert.equal(data.error, "confirmation_mismatch");
  assert.equal(fixture.runQueries.length, 0);
});

test("billing confirmation is idempotent when the same payment is retried", async () => {
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
      expires_at: "2099-08-21T00:30:00.000Z",
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

  const response = await handleBilling(createConfirmationRequest(
    {
      order_id: "order-1",
      provider: "toss_autobilling",
      provider_order_id: "provider-order-1",
      provider_payment_id: "payment-1",
      amount: 17000,
      currency: "KRW",
    },
    {
      "X-Internal-Token": fixture.env.INTERNAL_SECRET,
      "X-User-Id": "user-1",
    },
  ), fixture.env as never);

  assert.equal(response.status, 200);
  const data = await response.json() as Record<string, unknown>;
  assert.equal(data.ok, true);
  assert.equal(data.reused, true);
  assert.deepEqual(data.payment, {
    provider_payment_id: "payment-1",
    provider: "toss_autobilling",
    method: "card",
    amount: 17000,
    currency: "KRW",
    status: "paid",
    approved_at: "2026-08-21T00:00:00.000Z",
    canceled_at: null,
  });
});

test("next billing confirmation proxy forwards authenticated requests to the worker", () => {
  assert.match(nextBillingConfirmProxySource, /fetch\(`\$\{getWorkerUrl\(\)\}\/api\/billing\/confirm`/);
  assert.match(nextBillingConfirmProxySource, /"X-User-Id": user\.id/);
});
