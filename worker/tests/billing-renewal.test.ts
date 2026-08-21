import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BILLING_RENEWAL_RETRY_DELAY_MS, calculateBillingSubscriptionRetryAt } from "../src/lib/billing-subscriptions.ts";

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
  assert.match(renewalsSource, /markBillingSubscriptionRenewed/);
  assert.match(renewalsSource, /markBillingSubscriptionRenewalFailed/);
});
