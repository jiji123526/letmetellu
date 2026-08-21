import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handleBilling } from "../src/routes/billing.ts";

const nextTossPrepareProxySource = readFileSync(
  new URL("../../src/app/api/billing/toss/prepare/route.ts", import.meta.url),
  "utf8",
);
const nextTossConfirmProxySource = readFileSync(
  new URL("../../src/app/api/billing/toss/confirm/route.ts", import.meta.url),
  "utf8",
);
const checkoutPageSource = readFileSync(
  new URL("../../src/app/billing/checkout/page.tsx", import.meta.url),
  "utf8",
);
const successPageSource = readFileSync(
  new URL("../../src/app/billing/callback/toss/success/page.tsx", import.meta.url),
  "utf8",
);
const billingRouteSource = readFileSync(
  new URL("../src/routes/billing.ts", import.meta.url),
  "utf8",
);

function createPrepareRequest(body: Record<string, unknown>, headers?: HeadersInit) {
  return new Request("https://api.example.test/api/billing/toss/prepare", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createMockEnv() {
  const env = {
    INTERNAL_SECRET: "internal-secret",
    APP_ORIGIN: "https://yapndot.com",
    DB: {
      prepare(query: string) {
        return {
          bind(...params: unknown[]) {
            return {
              async first<T>() {
                if (query.includes("FROM billing_orders")) {
                  return {
                    order_id: params[0],
                    user_id: params[1],
                    plan: "plus",
                    billing_cycle: "monthly",
                    amount: 2900,
                    currency: "KRW",
                    provider: "toss_autobilling",
                    provider_order_id: null,
                    status: "pending",
                    auto_renews: 1,
                    expires_at: "2099-08-21T00:30:00.000Z",
                  } as T;
                }
                if (query.includes("FROM users")) {
                  return {
                    id: "user-1",
                    email: "hello@yapndot.com",
                    name: "Yap User",
                  } as T;
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

test("toss prepare route returns a billing-auth checkout payload for a pending order", async () => {
  const fixture = createMockEnv();
  const response = await handleBilling(createPrepareRequest(
    { order_id: "order-1" },
    {
      "X-Internal-Token": fixture.env.INTERNAL_SECRET,
      "X-User-Id": "user-1",
    },
  ), fixture.env as never);

  assert.equal(response.status, 200);
  const data = await response.json() as Record<string, unknown>;
  assert.equal(data.ok, true);
  assert.deepEqual(data.order, {
    order_id: "order-1",
    plan: "plus",
    billing_cycle: "monthly",
    amount: 2900,
    currency: "KRW",
    provider: "toss_autobilling",
    provider_order_id: null,
    status: "pending",
    auto_renews: true,
    expires_at: "2099-08-21T00:30:00.000Z",
    tax_mode: "vat_exclusive",
  });
  assert.deepEqual(data.checkout, {
    provider: "toss_autobilling",
    customer_key: "yap-user-user-1",
    customer_email: "hello@yapndot.com",
    customer_name: "Yap User",
    order_name: "yap. Plus 30 days",
    success_url: "https://yapndot.com/billing/callback/toss/success?order_id=order-1",
    fail_url: "https://yapndot.com/billing/callback/toss/fail?order_id=order-1",
  });
});

test("toss checkout wiring exists across worker, next proxies, and callback pages", () => {
  assert.match(billingRouteSource, /\/api\/billing\/toss\/prepare/);
  assert.match(billingRouteSource, /\/api\/billing\/toss\/confirm/);
  assert.match(billingRouteSource, /\/v1\/billing\/authorizations\/issue/);
  assert.match(nextTossPrepareProxySource, /client_key/);
  assert.match(nextTossPrepareProxySource, /\/api\/billing\/toss\/prepare/);
  assert.match(nextTossConfirmProxySource, /\/api\/billing\/toss\/confirm/);
  assert.match(checkoutPageSource, /requestBillingAuth\(\{/);
  assert.match(checkoutPageSource, /method: "CARD"/);
  assert.match(checkoutPageSource, /prepareTossCheckout/);
  assert.match(successPageSource, /authKey/);
  assert.match(successPageSource, /customerKey/);
  assert.match(successPageSource, /confirmTossCheckout/);
});
