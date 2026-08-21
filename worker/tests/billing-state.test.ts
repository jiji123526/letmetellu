import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handleBilling } from "../src/routes/billing.ts";

type BillingSubscriptionFixture = {
  id: string;
  user_id: string;
  provider: string;
  plan: string;
  billing_cycle: string;
  provider_customer_key: string;
  billing_key: string;
  status: "active" | "past_due" | "non_renewing" | "canceled";
  current_period_order_id: string | null;
  current_period_started_at: string;
  current_period_ends_at: string;
  next_charge_at: string;
  last_charged_at: string | null;
  last_failed_at: string | null;
  failure_count: number;
  cancel_requested_at: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
};

type BillingOrderFixture = {
  order_id: string;
  user_id: string;
  plan: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  provider: string;
  provider_order_id: string | null;
  status: string;
  auto_renews: number;
  expires_at: string | null;
};

type BillingEntitlementFixture = {
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
  grandfathered_channel_id: string | null;
  created_at: string;
  updated_at: string;
};

const nextBillingProxySource = readFileSync(
  new URL("../../src/app/api/billing/route.ts", import.meta.url),
  "utf8",
);
const nextBillingCancelProxySource = readFileSync(
  new URL("../../src/app/api/billing/cancel/route.ts", import.meta.url),
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

function createBillingCancelRequest(headers?: HeadersInit) {
  return new Request("https://api.example.test/api/billing/cancel", {
    method: "POST",
    headers,
  });
}

function createMockEnv(options?: {
  userExists?: boolean;
  activeEntitlement?: BillingEntitlementFixture | null;
  currentOrder?: BillingOrderFixture | null;
  subscription?: BillingSubscriptionFixture | null;
}) {
  const state = {
    userExists: options?.userExists ?? true,
    activeEntitlement: options?.activeEntitlement ?? null,
    currentOrder: options?.currentOrder ?? null,
    subscription: options?.subscription ?? null,
  };

  const env = {
    INTERNAL_SECRET: "internal-secret",
    PLUS_BETA_GRANDFATHER_ALL_USERS: "0",
    DB: {
      prepare(query: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first<T>() {
                if (query.includes("SELECT id FROM users")) {
                  return state.userExists ? ({ id: "user-1" } as T) : null;
                }
                if (query.includes("FROM user_entitlements")) {
                  return state.activeEntitlement as T | null;
                }
                if (query.includes("FROM billing_subscriptions")) {
                  return state.subscription as T | null;
                }
                if (query.includes("FROM billing_orders")) {
                  return state.currentOrder as T | null;
                }
                return null;
              },
              async run() {
                if (query.includes("UPDATE billing_subscriptions")) {
                  const [effectiveAt, updatedAt, orderId] = args as [string, string, string | null];
                  if (state.subscription && state.subscription.current_period_order_id === orderId) {
                    state.subscription = {
                      ...state.subscription,
                      status: "non_renewing",
                      cancel_requested_at: state.subscription.cancel_requested_at || effectiveAt,
                      updated_at: updatedAt,
                    };
                  }
                  return { success: true, meta: { changes: 1 } };
                }
                if (query.includes("UPDATE billing_orders")) {
                  const [updatedAt, orderId] = args as [string, string | null];
                  if (state.currentOrder && state.currentOrder.order_id === orderId && state.currentOrder.status === "confirmed") {
                    state.currentOrder = {
                      ...state.currentOrder,
                      status: "non_renewing",
                    };
                  }
                  if (state.currentOrder) {
                    state.currentOrder = {
                      ...state.currentOrder,
                      provider_order_id: state.currentOrder.provider_order_id,
                    };
                  }
                  void updatedAt;
                  return { success: true, meta: { changes: 1 } };
                }
                if (query.includes("UPDATE user_entitlements")) {
                  const [updatedAt, orderId] = args as [string, string | null];
                  if (state.activeEntitlement && state.activeEntitlement.source_order_id === orderId) {
                    state.activeEntitlement = {
                      ...state.activeEntitlement,
                      auto_renews: 0,
                      updated_at: updatedAt,
                    };
                  }
                  return { success: true, meta: { changes: 1 } };
                }
                if (query.includes("INSERT OR IGNORE INTO user_entitlements")) {
                  return { success: true, meta: { changes: 0 } };
                }
                return { success: true, meta: { changes: 1 } };
              },
              async all<T>() {
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    },
  };

  return { env, state };
}

test("billing state route returns active entitlement and subscription snapshots", async () => {
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
    subscription: {
      id: "subscription-1",
      user_id: "user-1",
      provider: "toss_autobilling",
      plan: "plus",
      billing_cycle: "monthly",
      provider_customer_key: "customer-1",
      billing_key: "billing-key-1",
      status: "past_due",
      current_period_order_id: "order-1",
      current_period_started_at: "2026-08-21T00:00:00.000Z",
      current_period_ends_at: "2026-09-20T00:00:00.000Z",
      next_charge_at: "2026-08-22T00:00:00.000Z",
      last_charged_at: "2026-08-21T00:00:00.000Z",
      last_failed_at: "2026-08-21T12:00:00.000Z",
      failure_count: 2,
      cancel_requested_at: null,
      canceled_at: null,
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T12:00:00.000Z",
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
  assert.equal("latest_pending_order" in data, false);
  assert.deepEqual(data.subscription, {
    id: "subscription-1",
    provider: "toss_autobilling",
    plan: "plus",
    billing_cycle: "monthly",
    status: "past_due",
    current_period_started_at: "2026-08-21T00:00:00.000Z",
    current_period_ends_at: "2026-09-20T00:00:00.000Z",
    next_charge_at: "2026-08-22T00:00:00.000Z",
    last_charged_at: "2026-08-21T00:00:00.000Z",
    last_failed_at: "2026-08-21T12:00:00.000Z",
    failure_count: 2,
    cancel_requested_at: null,
    canceled_at: null,
  });
});

test("billing cancel route marks the subscription as non-renewing and disables auto-renew", async () => {
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
    currentOrder: {
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
      expires_at: null,
    },
    subscription: {
      id: "subscription-1",
      user_id: "user-1",
      provider: "toss_autobilling",
      plan: "plus",
      billing_cycle: "monthly",
      provider_customer_key: "customer-1",
      billing_key: "billing-key-1",
      status: "active",
      current_period_order_id: "order-1",
      current_period_started_at: "2026-08-21T00:00:00.000Z",
      current_period_ends_at: "2026-09-20T00:00:00.000Z",
      next_charge_at: "2026-09-20T00:00:00.000Z",
      last_charged_at: "2026-08-21T00:00:00.000Z",
      last_failed_at: null,
      failure_count: 0,
      cancel_requested_at: null,
      canceled_at: null,
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z",
    },
  });

  const response = await handleBilling(createBillingCancelRequest({
    "X-Internal-Token": fixture.env.INTERNAL_SECRET,
    "X-User-Id": "user-1",
  }), fixture.env as never);

  assert.equal(response.status, 200);
  const data = await response.json() as Record<string, unknown>;
  assert.equal(data.ok, true);
  assert.equal(data.reused, false);
  assert.deepEqual(data.subscription, {
    id: "subscription-1",
    provider: "toss_autobilling",
    plan: "plus",
    billing_cycle: "monthly",
    status: "non_renewing",
    current_period_started_at: "2026-08-21T00:00:00.000Z",
    current_period_ends_at: "2026-09-20T00:00:00.000Z",
    next_charge_at: "2026-09-20T00:00:00.000Z",
    last_charged_at: "2026-08-21T00:00:00.000Z",
    last_failed_at: null,
    failure_count: 0,
    cancel_requested_at: fixture.state.subscription?.cancel_requested_at || null,
    canceled_at: null,
  });
  assert.equal(fixture.state.subscription?.status, "non_renewing");
  assert.match(fixture.state.subscription?.cancel_requested_at || "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(fixture.state.currentOrder?.status, "non_renewing");
  assert.equal(fixture.state.activeEntitlement?.auto_renews, 0);
});

test("billing state and cancel routes are wired through next proxies and dashboard plan details UI", () => {
  assert.match(nextBillingProxySource, /export async function GET\(\)/);
  assert.match(nextBillingProxySource, /\/api\/billing\/state/);
  assert.match(nextBillingCancelProxySource, /export async function POST\(\)/);
  assert.match(nextBillingCancelProxySource, /\/api\/billing\/cancel/);
  assert.match(dashboardSource, /dashboardPlanDetailsTitle/);
  assert.match(dashboardSource, /fetchBillingState/);
  assert.doesNotMatch(dashboardSource, /latest_pending_order/);
  assert.match(dashboardSource, /cancelBillingSubscription/);
  assert.match(dashboardSource, /dashboardPlanRetryNotice/);
});
