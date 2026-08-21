import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildOwnerPlanBillingSummary,
  buildImageQuotaActorIdentity,
  ensureBetaGrandfatheredPlusEntitlement,
  hasActivePlusEntitlement,
  isBetaGrandfatherAllUsersEnabled,
} from "../src/lib/plan-entitlements.ts";

const migrationSource = readFileSync(
  new URL("../migrations/0055_monetization_foundation.sql", import.meta.url),
  "utf8",
);
const grandfatheredMigrationSource = readFileSync(
  new URL("../migrations/0056_grandfathered_beta_plus.sql", import.meta.url),
  "utf8",
);

test("monetization foundation migration creates billing and quota tables", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS billing_orders/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS payments/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS user_entitlements/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS billing_webhook_events/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS image_quota_events/);
  assert.match(migrationSource, /CREATE UNIQUE INDEX IF NOT EXISTS image_quota_events_record_idx/);
  assert.match(migrationSource, /CREATE INDEX IF NOT EXISTS user_entitlements_user_plan_status_idx/);
});

test("grandfathered beta migration backfills permanent plus entitlements for current users", () => {
  assert.match(grandfatheredMigrationSource, /CREATE UNIQUE INDEX IF NOT EXISTS user_entitlements_grandfathered_beta_user_idx/);
  assert.match(grandfatheredMigrationSource, /INSERT OR IGNORE INTO user_entitlements/);
  assert.match(grandfatheredMigrationSource, /'grandfathered-beta:' \|\| users\.id/);
  assert.match(grandfatheredMigrationSource, /'grandfathered_beta'/);
  assert.match(grandfatheredMigrationSource, /FROM users/);
});

test("image quota actor identity prefers authenticated users", () => {
  assert.deepEqual(
    buildImageQuotaActorIdentity({
      authenticatedUserId: "user-1",
      anonymousUid: "anon-1",
      deviceId: "device-1",
    }),
    {
      primaryKey: "user:user-1",
      primaryType: "authenticated",
      secondaryKey: null,
      secondaryType: null,
    },
  );
});

test("image quota actor identity falls back to anonymous and device keys", () => {
  assert.deepEqual(
    buildImageQuotaActorIdentity({
      anonymousUid: "anon-1",
      deviceId: "device-1",
    }),
    {
      primaryKey: "anonymous:anon-1",
      primaryType: "anonymous",
      secondaryKey: "device:device-1",
      secondaryType: "device",
    },
  );
});

test("image quota actor identity returns null without usable identifiers", () => {
  assert.equal(buildImageQuotaActorIdentity({}), null);
});

test("owner plan billing summary exposes grandfathered and renewal state", () => {
  assert.deepEqual(buildOwnerPlanBillingSummary({
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
  }), {
    sourceType: "grandfathered_beta",
    provider: null,
    currentPeriodEndsAt: null,
    autoRenews: false,
    isGrandfathered: true,
  });
});

test("active plus entitlement lookup reads current active rows only", async () => {
  let capturedQuery = "";
  let capturedParams: unknown[] = [];
  const env = {
    DB: {
      prepare(query: string) {
        capturedQuery = query;
        return {
          bind(...params: unknown[]) {
            capturedParams = params;
            return {
              async first() {
                return { id: "entitlement-1" };
              },
            };
          },
        };
      },
    },
  };

  const result = await hasActivePlusEntitlement(
    env as never,
    "user-1",
    "2026-08-21T00:00:00.000Z",
  );

  assert.equal(result, true);
  assert.match(capturedQuery, /plan = 'plus'/);
  assert.match(capturedQuery, /status = 'active'/);
  assert.match(capturedQuery, /\(ends_at IS NULL OR ends_at > \?\)/);
  assert.deepEqual(capturedParams, [
    "user-1",
    "2026-08-21T00:00:00.000Z",
    "2026-08-21T00:00:00.000Z",
  ]);
});

test("beta grandfathering flag accepts explicit truthy values only", () => {
  assert.equal(isBetaGrandfatherAllUsersEnabled({
    PLUS_BETA_GRANDFATHER_ALL_USERS: "true",
  } as never), true);
  assert.equal(isBetaGrandfatherAllUsersEnabled({
    PLUS_BETA_GRANDFATHER_ALL_USERS: "1",
  } as never), true);
  assert.equal(isBetaGrandfatherAllUsersEnabled({
    PLUS_BETA_GRANDFATHER_ALL_USERS: "false",
  } as never), false);
});

test("beta grandfathering helper inserts a permanent plus entitlement only when enabled", async () => {
  const queries: string[] = [];
  const boundParams: unknown[][] = [];
  let firstCall = true;
  const env = {
    PLUS_BETA_GRANDFATHER_ALL_USERS: "true",
    DB: {
      prepare(query: string) {
        queries.push(query);
        return {
          bind(...params: unknown[]) {
            boundParams.push(params);
            return {
              async first() {
                if (firstCall) {
                  firstCall = false;
                  return null;
                }
                return {
                  id: "grandfathered-entitlement",
                  user_id: "user-1",
                  plan: "plus",
                  status: "active",
                };
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

  const result = await ensureBetaGrandfatheredPlusEntitlement(
    env as never,
    "user-1",
    "2026-08-21T00:00:00.000Z",
  );

  assert.equal(result?.id, "grandfathered-entitlement");
  assert.equal(queries.length, 3);
  assert.match(queries[1], /INSERT OR IGNORE INTO user_entitlements/);
  assert.match(queries[1], /'grandfathered_beta'/);
  assert.deepEqual(boundParams[1].slice(1), [
    "user-1",
    "2026-08-21T00:00:00.000Z",
    "user-1",
    "2026-08-21T00:00:00.000Z",
    "2026-08-21T00:00:00.000Z",
  ]);
});
