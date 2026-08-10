import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dataRouteSource = readFileSync(
  new URL("../src/routes/data.ts", import.meta.url),
  "utf8",
);

test("message context derives a flat root and reuses direct thread reads", () => {
  assert.match(dataRouteSource, /const threadRootId = target\.reply_to \|\| target\.id/);
  assert.match(dataRouteSource, /readVisibleFlatThreads\(env, channelId, \[threadRootId\]\)/);
  assert.doesNotMatch(dataRouteSource, /WITH RECURSIVE ancestors/);
  assert.doesNotMatch(dataRouteSource, /WITH RECURSIVE thread/);
});
