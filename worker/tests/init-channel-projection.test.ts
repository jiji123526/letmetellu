import assert from "node:assert/strict";
import test from "node:test";
import { mergeInitChannelProjection } from "../src/lib/init-channel-projection.ts";

test("init accepts control enrichment only for the canonical shard owner", () => {
  const merged = mergeInitChannelProjection(
    { id: "channel-a", owner_uid: "owner-a", name: "Canonical" },
    {
      projection_owner_uid: "owner-a",
      owner_name: "Owner A",
      owner_channel_count: 9,
      reports_owner_id: "reports-owner",
    },
  );

  assert.equal(merged.owner_name, "Owner A");
  assert.equal(merged.owner_channel_count, 2);
  assert.equal(merged.reports_owner_id, "reports-owner");
});

test("init rejects stale owner enrichment without changing canonical ownership", () => {
  const merged = mergeInitChannelProjection(
    { id: "channel-a", owner_uid: "owner-new", name: "Canonical" },
    {
      projection_owner_uid: "owner-old",
      owner_name: "Old Owner",
      owner_channel_count: 2,
      reports_owner_id: "reports-owner",
    },
  );

  assert.equal(merged.owner_uid, "owner-new");
  assert.equal(merged.owner_name, null);
  assert.equal(merged.owner_channel_count, 0);
  assert.equal(merged.reports_owner_id, "reports-owner");
});

test("init clamps invalid projected channel counts", () => {
  const merged = mergeInitChannelProjection(
    { id: "channel-a", owner_uid: "owner-a" },
    {
      projection_owner_uid: "owner-a",
      owner_channel_count: -10,
    },
  );

  assert.equal(merged.owner_channel_count, 0);
});
