import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BILLING_ORDER_TTL_MINUTES,
  DEFAULT_BILLING_PROVIDER,
  calculateBillingOrderExpiresAt,
  resolveBillingPlanSelection,
} from "../src/lib/billing-plans.ts";
import { handleBilling } from "../src/routes/billing.ts";

const workerIndexSource = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);
const nextBillingProxySource = readFileSync(
  new URL("../../src/app/api/billing/route.ts", import.meta.url),
  "utf8",
);

function createBillingRequest(body: Record<string, unknown>, headers?: HeadersInit) {
  return new Request("https://api.example.test/api/billing/order", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createMockEnv(options?: {
  userExists?: boolean;
  activeEntitlement?: Record<string, unknown> | null;
  existingPending?: Record<string, unknown> | null;
  betaGrandfatherAllUsers?: string | undefined;
}) {
  const queries: string[] = [];
  const boundParams: unknown[][] = [];
  let insertRunCount = 0;

  const env = {
    INTERNAL_SECRET: "internal-secret",
    PLUS_BETA_GRANDFATHER_ALL_USERS: options?.betaGrandfatherAllUsers,
    DB: {
      prepare(query: string) {
        queries.push(query);
        return {
          bind(...params: unknown[]) {
            boundParams.push(params);
            return {
              async first<T>() {
                if (query.includes("SELECT id FROM users")) {
                  return (options?.userExists ?? true)
                    ? ({ id: "user-1" } as T)
                    : null;
                }
                if (query.includes("FROM user_entitlements")) {
                  return (options?.activeEntitlement ?? null) as T | null;
                }
                if (query.includes("FROM billing_orders")) {
                  return (options?.existingPending ?? null) as T | null;
                }
                return null;
              },
              async run() {
                insertRunCount += 1;
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  return { env, queries, boundParams, getInsertRunCount: () => insertRunCount };
}

test("billing plan catalog resolves the chosen plus beta prices", () => {
  assert.deepEqual(resolveBillingPlanSelection({
    plan: "plus",
    billingCycle: "monthly",
  }), {
    plan: "plus",
    billingCycle: "monthly",
    provider: DEFAULT_BILLING_PROVIDER,
    amount: 2900,
    currency: "KRW",
    autoRenews: true,
    taxMode: "vat_exclusive",
    durationDays: 30,
  });
  assert.deepEqual(resolveBillingPlanSelection({
    plan: "plus",
    billingCycle: "yearly",
  }), {
    plan: "plus",
    billingCycle: "yearly",
    provider: DEFAULT_BILLING_PROVIDER,
    amount: 17000,
    currency: "KRW",
    autoRenews: true,
    taxMode: "vat_exclusive",
    durationDays: 365,
  });
  assert.equal(resolveBillingPlanSelection({
    plan: "plus",
    billingCycle: "weekly",
  }), null);
});

test("billing order expiry keeps pending orders short-lived", () => {
  assert.equal(
    calculateBillingOrderExpiresAt("2026-08-21T00:00:00.000Z", BILLING_ORDER_TTL_MINUTES),
    "2026-08-21T00:30:00.000Z",
  );
});

test("billing order route creates a pending server-authoritative order", async () => {
  const fixture = createMockEnv();
  const response = await handleBilling(createBillingRequest(
    { plan: "plus", billing_cycle: "monthly" },
    {
      "X-Internal-Token": fixture.env.INTERNAL_SECRET,
      "X-User-Id": "user-1",
    },
  ), fixture.env as never);

  assert.equal(response.status, 201);
  const data = await response.json() as Record<string, unknown>;
  assert.equal(data.ok, true);
  assert.equal(data.reused, false);
  assert.equal(typeof (data.order as { order_id: string }).order_id, "string");
  assert.deepEqual(
    Object.fromEntries(Object.entries(data.order as Record<string, unknown>).filter(([key]) => key !== "order_id" && key !== "expires_at")),
    {
      plan: "plus",
      billing_cycle: "monthly",
      amount: 2900,
      currency: "KRW",
      provider: DEFAULT_BILLING_PROVIDER,
      provider_order_id: null,
      status: "pending",
      auto_renews: true,
      tax_mode: "vat_exclusive",
    },
  );
  assert.equal(fixture.getInsertRunCount(), 1);
  assert.match(fixture.queries.join("\n"), /INSERT INTO billing_orders/);

  const insertBind = fixture.boundParams.find((params) => (
    params[1] === "user-1"
    && params[2] === "plus"
    && params[3] === "monthly"
  ));
  assert.ok(insertBind);
  assert.equal(insertBind?.[4], 2900);
  assert.equal(insertBind?.[5], "KRW");
  assert.equal(insertBind?.[6], DEFAULT_BILLING_PROVIDER);
  assert.equal(insertBind?.[7], 1);
});

test("billing order route reuses an unexpired pending order for the same purchase", async () => {
  const fixture = createMockEnv({
    existingPending: {
      order_id: "order-1",
      plan: "plus",
      billing_cycle: "yearly",
      amount: 17000,
      currency: "KRW",
      provider: DEFAULT_BILLING_PROVIDER,
      status: "pending",
      auto_renews: 1,
      expires_at: "2026-08-21T00:30:00.000Z",
    },
  });

  const response = await handleBilling(createBillingRequest(
    { plan: "plus", billing_cycle: "yearly" },
    {
      "X-Internal-Token": fixture.env.INTERNAL_SECRET,
      "X-User-Id": "user-1",
    },
  ), fixture.env as never);

  assert.equal(response.status, 200);
  const data = await response.json() as Record<string, unknown>;
  assert.equal(data.ok, true);
  assert.equal(data.reused, true);
  assert.deepEqual(data.order, {
    order_id: "order-1",
    plan: "plus",
    billing_cycle: "yearly",
    amount: 17000,
    currency: "KRW",
    provider: DEFAULT_BILLING_PROVIDER,
    provider_order_id: null,
    status: "pending",
    auto_renews: true,
    expires_at: "2026-08-21T00:30:00.000Z",
    tax_mode: "vat_exclusive",
  });
  assert.equal(fixture.getInsertRunCount(), 0);
});

test("billing order route blocks checkout when the user already has plus", async () => {
  const fixture = createMockEnv({
    activeEntitlement: {
      id: "entitlement-1",
      user_id: "user-1",
      provider: null,
      plan: "plus",
      status: "active",
      starts_at: "2026-08-01T00:00:00.000Z",
      ends_at: null,
      source_order_id: null,
      source_type: "grandfathered_beta",
      provider_customer_id: null,
      provider_subscription_id: null,
      auto_renews: 0,
      grandfathered_channel_id: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
  });

  const response = await handleBilling(createBillingRequest(
    { plan: "plus", billing_cycle: "monthly" },
    {
      "X-Internal-Token": fixture.env.INTERNAL_SECRET,
      "X-User-Id": "user-1",
    },
  ), fixture.env as never);

  assert.equal(response.status, 409);
  const data = await response.json() as Record<string, unknown>;
  assert.equal(data.error, "already_entitled");
  assert.deepEqual(data.entitlement, {
    plan: "plus",
    status: "active",
    source_type: "grandfathered_beta",
    starts_at: "2026-08-01T00:00:00.000Z",
    ends_at: null,
    auto_renews: false,
  });
});

test("billing route is wired through the worker entrypoint and next proxy", () => {
  assert.match(workerIndexSource, /import \{ handleBilling \} from "\.\/routes\/billing"/);
  assert.match(workerIndexSource, /url\.pathname\.startsWith\("\/api\/billing"\)/);
  assert.match(nextBillingProxySource, /fetch\(`\$\{getWorkerUrl\(\)\}\/api\/billing\/order`/);
  assert.match(nextBillingProxySource, /"X-User-Id": user\.id/);
});
