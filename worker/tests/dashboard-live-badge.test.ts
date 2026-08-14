import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const userRouteSource = readFileSync(
  new URL("../src/routes/user.ts", import.meta.url),
  "utf8",
);
const recentRouteSource = readFileSync(
  new URL("../src/routes/recent-channels.ts", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../../src/app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const accountRecentSource = readFileSync(
  new URL("../../src/lib/account-recent-channels.ts", import.meta.url),
  "utf8",
);

test("public and account channel summaries expose only unexpired live sessions", () => {
  assert.match(
    userRouteSource,
    /CASE WHEN live_config\.id IS NOT NULL THEN 1 ELSE 0 END AS live_active/,
  );
  assert.match(userRouteSource, /json_extract\(live_config\.text, '\$\.expiresAt'\)/);
  assert.match(
    recentRouteSource,
    /CASE WHEN live_config\.id IS NOT NULL THEN 1 ELSE 0 END AS live_active/,
  );
  assert.match(recentRouteSource, /json_extract\(live_config\.text, '\$\.expiresAt'\)/);
});

test("anonymous and joined dashboard channels render authoritative live state", () => {
  assert.match(dashboardSource, /liveActive: authoritative\.live_active === 1/);
  assert.match(dashboardSource, /liveActive: channel\.liveActive === true/);
  assert.match(dashboardSource, /liveActive: linkedChannel\.live_active === 1/);
  assert.match(dashboardSource, /RECENT_CHANNELS_POLL_MS = 60000/);
  assert.match(dashboardSource, /void refreshDashboardLiveStates\(\)/);
});

test("cached account snapshots cannot flash a stale live badge", () => {
  assert.match(accountRecentSource, /liveActive: false/);
  assert.match(accountRecentSource, /liveActive: channel\.live_active === 1/);
});
