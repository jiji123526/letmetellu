import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BILLING_RENEWAL_MAX_FAILURES,
  BILLING_RENEWAL_RETRY_DELAY_MS,
  calculateBillingSubscriptionRetryAt,
  markBillingSubscriptionRenewalFailed,
} from "../src/lib/billing-subscriptions.ts";

const maintenanceSource = readFileSync(
  new URL("../src/lib/maintenance.ts", import.meta.url),
  "utf8",
);
const renewalsSource = readFileSync(
  new URL("../src/lib/billing-renewals.ts", import.meta.url),
  "utf8",
);
const billingRouteSource = readFileSync(
  new URL("../src/routes/billing.ts", import.meta.url),
  "utf8",
);

test("billing renewal retry backoff defaults to 24 hours", () => {
  assert.equal(BILLING_RENEWAL_RETRY_DELAY_MS, 24 * 60 * 60 * 1000);
  assert.equal(
    calculateBillingSubscriptionRetryAt("2026-08-21T00:00:00.000Z"),
    "2026-08-22T00:00:00.000Z",
  );
});

test("third renewal failure caps the subscription at non-renewing", async () => {
  const state = {
    subscription: {
      id: "subscription-1",
      current_period_ends_at: "2026-09-20T00:00:00.000Z",
      status: "past_due",
      next_charge_at: "2026-08-22T00:00:00.000Z",
      last_failed_at: "2026-08-21T00:00:00.000Z",
      failure_count: 2,
      cancel_requested_at: null as string | null,
      updated_at: "2026-08-21T00:00:00.000Z",
    },
  };
  const env = {
    DB: {
      prepare(query: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async run() {
                if (!query.includes("UPDATE billing_subscriptions")) {
                  return { success: true, meta: { changes: 0 } };
                }
                const [
                  maxFailuresForStatus,
                  maxFailuresForRetryAt,
                  retryAt,
                  failedAt,
                  maxFailuresForCancelRequestedAt,
                  cancelRequestedAt,
                  updatedAt,
                  subscriptionId,
                ] = args as [number, number, string, string, number, string, string, string];
                assert.equal(subscriptionId, state.subscription.id);

                const nextFailureCount = state.subscription.failure_count + 1;
                state.subscription = {
                  ...state.subscription,
                  status: nextFailureCount >= maxFailuresForStatus ? "non_renewing" : "past_due",
                  next_charge_at: nextFailureCount >= maxFailuresForRetryAt
                    ? state.subscription.current_period_ends_at
                    : retryAt,
                  last_failed_at: failedAt,
                  failure_count: nextFailureCount,
                  cancel_requested_at: nextFailureCount >= maxFailuresForCancelRequestedAt
                    ? (state.subscription.cancel_requested_at || cancelRequestedAt)
                    : state.subscription.cancel_requested_at,
                  updated_at: updatedAt,
                };
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  await markBillingSubscriptionRenewalFailed(env as never, {
    subscriptionId: "subscription-1",
    failedAt: "2026-08-23T00:00:00.000Z",
    now: "2026-08-23T00:00:01.000Z",
  });

  assert.equal(BILLING_RENEWAL_MAX_FAILURES, 3);
  assert.equal(state.subscription.status, "non_renewing");
  assert.equal(state.subscription.failure_count, 3);
  assert.equal(state.subscription.next_charge_at, "2026-09-20T00:00:00.000Z");
  assert.equal(state.subscription.last_failed_at, "2026-08-23T00:00:00.000Z");
  assert.equal(state.subscription.cancel_requested_at, "2026-08-23T00:00:00.000Z");
});

test("scheduled maintenance runs billing renewals before other cleanup work", () => {
  assert.match(maintenanceSource, /runBillingSubscriptionRenewals/);
  assert.match(maintenanceSource, /const billingRenewals = await runBillingSubscriptionRenewals/);
  assert.match(maintenanceSource, /billingRenewalsAttempted: billingRenewals\.attempted/);
  assert.match(maintenanceSource, /billingRenewalsSucceeded: billingRenewals\.renewed/);
  assert.match(maintenanceSource, /billingRenewalsFailed: billingRenewals\.failed/);
});

test("renewal pipeline stores subscription records and charges Toss billing keys", () => {
  assert.match(billingRouteSource, /upsertBillingSubscription\(env/);
  assert.match(renewalsSource, /readDueBillingSubscriptions/);
  assert.match(renewalsSource, /INSERT INTO billing_orders/);
  assert.match(renewalsSource, /https:\/\/api\.tosspayments\.com\/v1\/billing/);
  assert.match(renewalsSource, /isValidTossBillingCharge\(chargeData/);
  assert.match(renewalsSource, /markBillingSubscriptionRenewed/);
  assert.match(renewalsSource, /markBillingSubscriptionRenewalFailed/);
});
