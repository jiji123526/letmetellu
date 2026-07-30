import assert from "node:assert/strict";
import test from "node:test";

import { getBlockedDeviceLookup, hashBlockedDeviceId } from "../src/lib/actor-identities.ts";
import type { Env } from "../src/types.ts";

const env = {
  INTERNAL_SECRET: "test-internal-secret",
} as Env;

test("hashBlockedDeviceId is deterministic and does not expose the raw device id", async () => {
  const raw = "device-123";
  const first = await hashBlockedDeviceId(raw, env);
  const second = await hashBlockedDeviceId(raw, env);
  const other = await hashBlockedDeviceId("device-456", env);

  assert.equal(first, second);
  assert.notEqual(first, raw);
  assert.notEqual(first, other);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("getBlockedDeviceLookup returns both raw and hashed lookup forms", async () => {
  const lookup = await getBlockedDeviceLookup("device-123", env);
  assert.equal(lookup.raw, "device-123");
  assert.match(lookup.hashed, /^[0-9a-f]{64}$/);

  const empty = await getBlockedDeviceLookup(null, env);
  assert.deepEqual(empty, { raw: "", hashed: "" });
});
