import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(
  new URL("../../src/app/dashboard/page.tsx", import.meta.url),
  "utf8",
);

test("signed-in dashboard prefetches recent channels while resolving the user role", () => {
  const startupStart = dashboardSource.indexOf("const runDashboardStartup = useEffectEvent");
  const startupEnd = dashboardSource.indexOf("useEffect(() => {", startupStart);
  const startupSource = dashboardSource.slice(startupStart, startupEnd);
  const prefetch = startupSource.indexOf("const prefetchedRecentChannels = fetchAccountRecentChannels()");
  const roleWait = startupSource.indexOf("await Promise.allSettled([loadChannels()])");
  const applyPrefetch = startupSource.indexOf("prefetchedRequest: prefetchedRecentChannels");

  assert.ok(prefetch >= 0);
  assert.ok(roleWait > prefetch, "recent-channel I/O should start before role resolution finishes");
  assert.ok(applyPrefetch > roleWait, "prefetched data should only be applied after role resolution");
});

test("prefetched recent-channel requests are not started a second time", () => {
  assert.match(
    dashboardSource,
    /options\?\.prefetchedRequest \?\? fetchAccountRecentChannels\(\)/,
  );
  assert.match(
    dashboardSource,
    /const ownsRequestTiming = !options\?\.prefetchedRequest/,
  );
});
