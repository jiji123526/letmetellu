import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FREE_DAILY_IMAGE_MESSAGE_LIMIT,
  getImageQuotaDateBucket,
  prepareAcceptedImageQuotaConsumption,
} from "../src/lib/image-quota.ts";

const messagesRouteSource = readFileSync(
  new URL("../src/routes/messages.ts", import.meta.url),
  "utf8",
);
const dmRouteSource = readFileSync(
  new URL("../src/routes/dm.ts", import.meta.url),
  "utf8",
);

function createQuotaEnv(options?: {
  activeEntitlement?: boolean;
  primaryCount?: number;
  secondaryCount?: number;
}) {
  const insertedRows: unknown[][] = [];

  const env = {
    DB: {
      prepare(query: string) {
        return {
          bind(...params: unknown[]) {
            return {
              async first<T>() {
                if (query.includes("FROM user_entitlements")) {
                  return (options?.activeEntitlement ?? false)
                    ? ({ id: "entitlement-1" } as T)
                    : null;
                }
                if (query.includes("FROM image_quota_events") && query.includes("secondary_actor_key = ?")) {
                  return { count: options?.secondaryCount ?? 0 } as T;
                }
                if (query.includes("FROM image_quota_events") && query.includes("actor_key = ?")) {
                  return { count: options?.primaryCount ?? 0 } as T;
                }
                return null;
              },
              async run() {
                if (query.includes("INSERT INTO image_quota_events")) {
                  insertedRows.push(params);
                }
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  return { env, insertedRows };
}

test("image quota date bucket resets at midnight KST", () => {
  assert.equal(
    getImageQuotaDateBucket("2026-08-21T14:59:59.999Z"),
    "2026-08-21",
  );
  assert.equal(
    getImageQuotaDateBucket("2026-08-21T15:00:00.000Z"),
    "2026-08-22",
  );
});

test("plus-entitled authenticated users bypass the free daily image quota", async () => {
  const { env } = createQuotaEnv({ activeEntitlement: true });
  const result = await prepareAcceptedImageQuotaConsumption(env as never, {
    authenticatedUserId: "user-1",
    channelId: "channel-a",
    recordType: "message",
    recordId: "message-1",
    now: "2026-08-21T12:00:00.000Z",
  });

  assert.deepEqual(result, {
    ok: true,
    bypassed: true,
    statement: null,
    quotaDate: "2026-08-21",
  });
});

test("free authenticated users get an idempotent quota ledger insert for accepted image messages", async () => {
  const { env, insertedRows } = createQuotaEnv({ activeEntitlement: false, primaryCount: 2 });
  const result = await prepareAcceptedImageQuotaConsumption(env as never, {
    authenticatedUserId: "user-1",
    channelId: "channel-a_live",
    recordType: "message",
    recordId: "message-1",
    now: "2026-08-21T12:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.bypassed, false);
  assert.equal(result.quotaDate, "2026-08-21");
  assert.ok(result.statement);

  await result.statement?.run();

  assert.deepEqual(insertedRows, [[
    "image:message:message-1",
    "user:user-1",
    "authenticated",
    null,
    null,
    "2026-08-21",
    "channel-a_live",
    "message",
    "message-1",
    "2026-08-21T12:00:00.000Z",
  ]]);
});

test("anonymous users are limited by the stronger of anonymous uid and device usage", async () => {
  const { env } = createQuotaEnv({
    primaryCount: 2,
    secondaryCount: FREE_DAILY_IMAGE_MESSAGE_LIMIT,
  });
  const result = await prepareAcceptedImageQuotaConsumption(env as never, {
    anonymousUid: "anon-1",
    deviceId: "device-1",
    channelId: "channel-a",
    recordType: "dm",
    recordId: "dm-1",
    now: "2026-08-21T12:00:00.000Z",
  });

  assert.deepEqual(result, {
    ok: false,
    error: "image_quota_exceeded",
    quotaDate: "2026-08-21",
  });
});

test("message and dm routes apply accepted-image quota checks across supported surfaces", () => {
  assert.match(messagesRouteSource, /prepareAcceptedImageQuotaConsumption/);
  assert.match(messagesRouteSource, /recordType: "message"/);
  assert.match(messagesRouteSource, /imageQuotaConsumption\.error/);

  assert.match(dmRouteSource, /prepareAcceptedImageQuotaConsumption/);
  assert.match(dmRouteSource, /recordType: "dm"/);
  assert.match(dmRouteSource, /recordType: "dm_reply"/);
  assert.match(dmRouteSource, /imageQuotaConsumption\.error/);
});
