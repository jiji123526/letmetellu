import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidTossBillingCharge,
  isValidTossBillingKeyIssue,
} from "../src/lib/toss-billing.ts";

test("billing-key issue requires the expected customer key", () => {
  assert.equal(isValidTossBillingKeyIssue({
    billingKey: "billing-key-1",
    customerKey: "customer-1",
  }, "customer-1"), true);

  assert.equal(isValidTossBillingKeyIssue({
    billingKey: "billing-key-1",
    customerKey: "another-customer",
  }, "customer-1"), false);
});

test("billing charge requires a completed matching billing payment", () => {
  const expected = {
    orderId: "order-1",
    amount: 2900,
    currency: "KRW",
  };
  const validCharge = {
    paymentKey: "payment-1",
    orderId: "order-1",
    totalAmount: 2900,
    currency: "KRW",
    status: "DONE",
    type: "BILLING",
  };

  assert.equal(isValidTossBillingCharge(validCharge, expected), true);

  for (const invalidField of [
    { status: "IN_PROGRESS" },
    { type: "NORMAL" },
    { orderId: "order-2" },
    { totalAmount: 1 },
    { currency: "USD" },
  ]) {
    assert.equal(isValidTossBillingCharge({
      ...validCharge,
      ...invalidField,
    }, expected), false);
  }
});
