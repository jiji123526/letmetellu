import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handleBilling } from "../src/routes/billing.ts";

const nextBillingProxySource = readFileSync(
  new URL("../../src/app/api/billing/route.ts", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../../src/app/dashboard/page.tsx", import.meta.url),
  "utf8",
);

function createBillingStateRequest(headers?: HeadersInit) {
  return new Request("https://api.example.test/api/billing/state", {
    method: "GET",
    headers,
  });
}

function createMockEnv(options?: {
  userExists?: boolean;
  activeEntitlement?: Record<string, unknown> | null;
  pendingOrder?: Record<string, unknown> | null;
}) {
  const env = {
    INTERNAL_SECRET: "internal-secret",
    DB: {
      prepare(query: string) {
        return {
          bind() {
            return {
              async first<T>() {
                if (query.includes("SELECT id FROM users")) {
                  return (options?.userExists ?? true) ? ({ id: "user-1" } as T) : null;
                }
                if (query.includes("FROM user_entitlements")) {
                  return (options?.activeEntitlement ?? null) as T | null;
                }
                if (query.includes("FROM billing_orders")) {
                  return (options?.pendingOrder ?? null) as T | null;
                }
                return null;
              },
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  return { env };
}

test("billing state route returns active entitlement and pending order snapshots", async () => {
  const fixture = createMockEnv({
    activeEntitlement: {
      id: "entitlement-1",
      user_id: "user-1",
      provider: "toss_autobilling",
      plan: "plus",
      status: "active",
      starts_at: "2026-08-21T00:00:00.000Z",
      ends_at: "2026-09-20T00:00:00.000Z",
      source_order_id: "order-1",
      source_type: "billing",
      provider_customer_id: "customer-1",
      provider_subscription_id: "subscription-1",
      auto_renews: 1,
      grandfathered_channel_id: null,
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z",
    },
    pendingOrder: {
      order_id: "order-2",
      user_id: "user-1",
      plan: "plus",
      billing_cycle: "monthly",
      amount: 2900,
      currency: "KRW",
      provider: "toss_autobilling",
      provider_order_id: null,
      status: "pending",
      auto_renews: 1,
      expires_at: "2026-08-21T00:30:00.000Z",
    },
  });

  const response = await handleBilling(createBillingStateRequest({
    "X-Internal-Token": fixture.env.INTERNAL_SECRET,
    "X-User-Id": "user-1",
  }), fixture.env as never);

  assert.equal(response.status, 200);
  const data = await response.json() as Record<string, unknown>;
  assert.equal(data.ok, true);
  assert.equal(Array.isArray(data.plans), true);
  assert.deepEqual(data.active_entitlement, {
    id: "entitlement-1",
    plan: "plus",
    status: "active",
    provider: "toss_autobilling",
    starts_at: "2026-08-21T00:00:00.000Z",
    ends_at: "2026-09-20T00:00:00.000Z",
    source_type: "billing",
    provider_customer_id: "customer-1",
    provider_subscription_id: "subscription-1",
    auto_renews: true,
  });
  assert.deepEqual(data.latest_pending_order, {
    order_id: "order-2",
    plan: "plus",
    billing_cycle: "monthly",
    amount: 2900,
    currency: "KRW",
    provider: "toss_autobilling",
    provider_order_id: null,
    status: "pending",
    auto_renews: true,
    expires_at: "2026-08-21T00:30:00.000Z",
    tax_mode: "vat_exclusive",
  });
});

test("billing state route is wired through next proxy and dashboard plan details UI", () => {
  assert.match(nextBillingProxySource, /export async function GET\(\)/);
  assert.match(nextBillingProxySource, /\/api\/billing\/state/);
  assert.match(dashboardSource, /dashboardPlanDetailsTitle/);
  assert.match(dashboardSource, /fetchBillingState/);
  assert.match(dashboardSource, /latest_pending_order/);
});
