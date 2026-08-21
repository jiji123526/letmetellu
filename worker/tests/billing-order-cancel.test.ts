import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handleBilling } from "../src/routes/billing.ts";

const nextCancelProxySource = readFileSync(
  new URL("../../src/app/api/billing/order/cancel/route.ts", import.meta.url),
  "utf8",
);
const checkoutPageSource = readFileSync(
  new URL("../../src/app/billing/checkout/page.tsx", import.meta.url),
  "utf8",
);
const failPageSource = readFileSync(
  new URL("../../src/app/billing/callback/toss/fail/page.tsx", import.meta.url),
  "utf8",
);

function createCancelRequest(orderId = "order-1", userId = "user-1") {
  return new Request("https://api.example.test/api/billing/order/cancel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": "internal-secret",
      "X-User-Id": userId,
    },
    body: JSON.stringify({ order_id: orderId }),
  });
}

function createMockEnv(initialStatus: string | null) {
  let status = initialStatus;
  const queries: string[] = [];

  const env = {
    INTERNAL_SECRET: "internal-secret",
    DB: {
      prepare(query: string) {
        queries.push(query);
        return {
          bind(...params: unknown[]) {
            return {
              async run() {
                const [, orderId, userId] = params;
                if (
                  query.includes("SET status = 'canceled'")
                  && orderId === "order-1"
                  && userId === "user-1"
                  && status === "pending"
                ) {
                  status = "canceled";
                  return { success: true, meta: { changes: 1 } };
                }
                return { success: true, meta: { changes: 0 } };
              },
              async first<T>() {
                const [orderId, userId] = params;
                if (orderId !== "order-1" || userId !== "user-1" || status === null) {
                  return null;
                }
                return { status } as T;
              },
            };
          },
        };
      },
    },
  };

  return { env, queries, getStatus: () => status };
}

test("pending billing order cancellation is ownership-scoped and idempotent", async () => {
  const fixture = createMockEnv("pending");
  const first = await handleBilling(createCancelRequest(), fixture.env as never);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    ok: true,
    reused: false,
    order_id: "order-1",
    status: "canceled",
  });
  assert.equal(fixture.getStatus(), "canceled");

  const repeated = await handleBilling(createCancelRequest(), fixture.env as never);
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), {
    ok: true,
    reused: true,
    order_id: "order-1",
    status: "canceled",
  });
  assert.match(fixture.queries.join("\n"), /user_id = \? AND status = 'pending'/);
});

test("billing order cancellation cannot alter confirmed or foreign orders", async () => {
  const confirmed = createMockEnv("confirmed");
  const confirmedResponse = await handleBilling(createCancelRequest(), confirmed.env as never);
  assert.equal(confirmedResponse.status, 409);
  assert.deepEqual(await confirmedResponse.json(), { error: "order_not_pending" });
  assert.equal(confirmed.getStatus(), "confirmed");

  const foreign = createMockEnv("pending");
  const foreignResponse = await handleBilling(
    createCancelRequest("order-1", "user-2"),
    foreign.env as never,
  );
  assert.equal(foreignResponse.status, 404);
  assert.deepEqual(await foreignResponse.json(), { error: "order_not_found" });
  assert.equal(foreign.getStatus(), "pending");
});

test("checkout exits and Toss failure callbacks reset the pending order", () => {
  assert.match(nextCancelProxySource, /\/api\/billing\/order\/cancel/);
  assert.match(nextCancelProxySource, /"X-User-Id": user\.id/);
  assert.match(checkoutPageSource, /cancelBillingOrder/);
  assert.match(checkoutPageSource, /pagehide/);
  assert.match(failPageSource, /cancelBillingOrder/);
});
