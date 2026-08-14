import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dataRouteSource = readFileSync(
  new URL("../src/routes/data.ts", import.meta.url),
  "utf8",
);

test("message context centers a root-indexed window and expands its threads", () => {
  assert.match(dataRouteSource, /WITH RECURSIVE ancestors/);
  assert.match(dataRouteSource, /AS thread_root_id/);
  assert.match(dataRouteSource, /VISIBLE_ROOT_MESSAGE_CONDITION/);
  assert.match(dataRouteSource, /expandVisibleRootThreads\(env, channelId, contextPageRows\)/);
  assert.match(dataRouteSource, /\(created_at, id\) <= \(\?, \?\)/);
  assert.match(dataRouteSource, /\(created_at, id\) > \(\?, \?\)/);
  assert.doesNotMatch(dataRouteSource, /WITH RECURSIVE thread/);
});
