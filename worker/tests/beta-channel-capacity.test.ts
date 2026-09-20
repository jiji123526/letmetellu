import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adminRouteSource = readFileSync(
  new URL("../src/routes/admin.ts", import.meta.url),
  "utf8",
);

test("the beta-wide channel capacity is 100 while the per-owner limit stays at five", () => {
  assert.match(adminRouteSource, /const BETA_CHANNEL_LIMIT = 100/);
  assert.match(adminRouteSource, /limit: BETA_CHANNEL_LIMIT/);
  assert.match(adminRouteSource, /can_create: count < BETA_CHANNEL_LIMIT/);
  assert.match(adminRouteSource, /id NOT LIKE '%_live'[\s\S]*\) < 5/);
  assert.match(adminRouteSource, /id NOT LIKE '%_live'[\s\S]*\) < \?/);
  assert.match(adminRouteSource, /BETA_CHANNEL_LIMIT,[\s\S]*\)\.run\(\)/);
  assert.match(adminRouteSource, />= BETA_CHANNEL_LIMIT/);
  assert.doesNotMatch(adminRouteSource, /count < 50|>= 50|\) < 50/);
});
