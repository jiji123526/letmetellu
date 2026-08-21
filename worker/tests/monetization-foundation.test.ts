import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildImageQuotaActorIdentity,
  hasActivePlusEntitlement,
} from "../src/lib/plan-entitlements.ts";

const migrationSource = readFileSync(
  new URL("../migrations/0055_monetization_foundation.sql", import.meta.url),
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
