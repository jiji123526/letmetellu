import assert from "node:assert/strict";
import test from "node:test";

import { advanceChannelRateLimit } from "../src/lib/channel-rate-limit.ts";

test("channel message rate limit increments within one aligned window", () => {
  const first = advanceChannelRateLimit(null, 10_001, 10_000, 5);
  const second = advanceChannelRateLimit(first, 19_999, 10_000, 5);
  assert.equal(first.count, 1);
  assert.equal(second.count, 2);
  assert.equal(second.ok, true);
  assert.equal(second.resetAt, new Date(20_000).toISOString());
});

test("channel message rate limit rejects above the limit and resets in a new window", () => {
  let bucket = advanceChannelRateLimit(null, 20_000, 10_000, 2);
  bucket = advanceChannelRateLimit(bucket, 20_001, 10_000, 2);
  const rejected = advanceChannelRateLimit(bucket, 20_002, 10_000, 2);
  const reset = advanceChannelRateLimit(rejected, 30_000, 10_000, 2);
  assert.equal(rejected.count, 3);
  assert.equal(rejected.ok, false);
  assert.equal(reset.count, 1);
  assert.equal(reset.ok, true);
});
