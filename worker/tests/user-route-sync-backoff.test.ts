import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiRouteSource = readFileSync(
  new URL("../../src/app/api/user/route.ts", import.meta.url),
  "utf8",
);
const workerUserRouteSource = readFileSync(
  new URL("../src/routes/user.ts", import.meta.url),
  "utf8",
);

test("user route backs off repeated missing-user sync attempts", () => {
  assert.match(apiRouteSource, /const MISSING_USER_SYNC_BACKOFF_MS = 5_000/);
  assert.match(apiRouteSource, /const recentMissingUserSyncs = new Map<string, number>\(\)/);
  assert.match(apiRouteSource, /if \(nextSyncAttemptAt > Date\.now\(\)\) {\s*return userReadResponse\(/);
  assert.match(apiRouteSource, /recentMissingUserSyncs\.set\(syncCacheKey, Date\.now\(\) \+ MISSING_USER_SYNC_BACKOFF_MS\)/);
});

test("current-user reads expose proxy and Worker stage timings", () => {
  assert.match(apiRouteSource, /"Server-Timing"/);
  assert.match(apiRouteSource, /auth;dur=\$\{timings\.authMs}/);
  assert.match(apiRouteSource, /worker;dur=\$\{timings\.workerMs}/);
  assert.match(apiRouteSource, /headers\.set\("X-Yap-Worker-Timing", workerTiming\)/);
  assert.match(workerUserRouteSource, /`identity=\$\{timings\.identityMs},state=\$\{timings\.stateMs},total=\$\{timings\.totalMs}`/);
});
