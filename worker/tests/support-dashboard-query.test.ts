import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const supportRouteSource = readFileSync(
  new URL("../src/routes/support.ts", import.meta.url),
  "utf8",
);
const supportIndexMigration = readFileSync(
  new URL("../migrations/0031_support_dashboard_query_indexes.sql", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../../src/app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const platformThreadSource = readFileSync(
  new URL("../../src/components/support/PlatformSupportThreadPanel.tsx", import.meta.url),
  "utf8",
);
const workerIndexSource = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);
const cleanupSource = readFileSync(
  new URL("../src/lib/channel-cleanup.ts", import.meta.url),
  "utf8",
);
const maintenanceSource = readFileSync(
  new URL("../src/lib/maintenance.ts", import.meta.url),
  "utf8",
);
const cleanupMigration = readFileSync(
  new URL("../migrations/0036_retryable_channel_cleanup.sql", import.meta.url),
  "utf8",
);

test("support thread reads use direct role-keyed joins", () => {
  assert.match(
    supportRouteSource,
    /LEFT JOIN support_thread_reads ur ON ur\.thread_id = st\.id AND ur\.actor_role = 'user'/,
  );
  assert.match(
    supportRouteSource,
    /LEFT JOIN support_thread_reads ar ON ar\.thread_id = st\.id AND ar\.actor_role = 'platform_admin'/,
  );
  assert.doesNotMatch(
    supportRouteSource,
    /SELECT read_at\s+FROM support_thread_reads/,
  );
});

test("support dashboard indexes cover pagination and both message lookup orders", () => {
  assert.match(
    supportIndexMigration,
    /support_threads\(status, updated_at DESC, id DESC\)/,
  );
  assert.match(
    supportIndexMigration,
    /support_messages\(thread_id, created_at DESC, id DESC, sender_role\)/,
  );
  assert.match(
    supportIndexMigration,
    /support_messages\(thread_id, sender_role, created_at DESC, id DESC\)/,
  );
  assert.match(supportIndexMigration, /DROP INDEX IF EXISTS support_threads_status_updated_idx/);
  assert.match(supportIndexMigration, /DROP INDEX IF EXISTS support_messages_thread_idx/);
});

test("platform support polling uses incremental messages and lightweight dashboard probes", () => {
  assert.match(
    supportRouteSource,
    /AND \(created_at > \? OR \(created_at = \? AND id > \?\)\)/,
  );
  assert.match(supportRouteSource, /type === "dashboard-version"/);
  assert.match(supportRouteSource, /type === "dashboard-stats"/);
  assert.match(supportRouteSource, /requestUrl\.searchParams\.get\("include_stats"\) !== "0"/);
  assert.match(supportRouteSource, /invalid_message_cursor/);
});

test("ticket lifecycle changes replace stale dashboard state and refresh statistics", () => {
  assert.match(
    dashboardSource,
    /if \(!current \|\| authoritative\) return nextDashboard/,
  );
  assert.match(
    dashboardSource,
    /if \(!authoritative\) return inFlightRequest;[\s\S]*await inFlightRequest/,
  );
  assert.match(
    dashboardSource,
    /previousVersion !== null && previousVersion !== result\.version[\s\S]*loadPlatformDashboard\(true, true\)/,
  );
  assert.match(
    dashboardSource,
    /const refresh = \(\) => \{[\s\S]*loadPlatformDashboard\(true, true\)[\s\S]*addEventListener\("support-ticket-changed", refresh/,
  );
  assert.match(
    platformThreadSource,
    /closePlatformSupportThread[\s\S]*support-ticket-changed/,
  );
});

test("unhandled requests are not counted again as generic request failures", () => {
  assert.match(
    workerIndexSource,
    /response\.status >= 500 && !capturedUnhandledException/,
  );
});

test("operational health groups websocket routes by normalized channel path", () => {
  assert.match(
    supportRouteSource,
    /WHEN route LIKE 'GET \/ws\/%' THEN 'GET \/ws\/:channel'/,
  );
  assert.match(
    workerIndexSource,
    /normalizeOperationalRoute\(request\.method, url\.pathname\)/,
  );
  assert.match(
    workerIndexSource,
    /response\.status === 404 && route === "GET \/api\/media\/:key"/,
  );
  assert.match(
    supportRouteSource,
    /SUM\(CASE WHEN event_type = 'media_not_found' THEN 1 ELSE 0 END\) AS media_not_found_count/,
  );
  assert.match(
    supportRouteSource,
    /SUM\(CASE WHEN event_type = 'cleanup_failed' THEN 1 ELSE 0 END\) AS cleanup_failure_count/,
  );
  assert.match(
    supportRouteSource,
    /SUM\(CASE WHEN event_type = 'realtime_unavailable' THEN 1 ELSE 0 END\) AS realtime_failure_count/,
  );
});

test("channel deletion records recoverable cleanup before deleting D1 state", () => {
  const batchStart = cleanupSource.indexOf("await env.DB.batch([");
  const insertJob = cleanupSource.indexOf("INSERT INTO cleanup_jobs", batchStart);
  const deleteChannel = cleanupSource.indexOf("DELETE FROM channels", batchStart);

  assert.ok(batchStart >= 0, "channel deletion should use one D1 batch");
  assert.ok(insertJob > batchStart, "cleanup job should be created in the deletion batch");
  assert.ok(deleteChannel > insertJob, "cleanup job should be recorded before channel rows are removed");
  assert.match(cleanupMigration, /UNIQUE \(resource_type, resource_id, resource_version\)/);
  assert.match(cleanupMigration, /cleanup_jobs_due_idx/);
});

test("scheduled maintenance retries and retains channel cleanup jobs", () => {
  assert.match(maintenanceSource, /retryPendingChannelCleanups\(env, nowMs, CHANNEL_CLEANUP_RETRY_LIMIT\)/);
  assert.match(maintenanceSource, /deleteCompletedCleanupJobs\(env, cutoff, CLEANUP_BATCH_LIMIT\)/);
  assert.match(cleanupSource, /eventType: "cleanup_failed"/);
  assert.match(cleanupSource, /eventType: "cleanup_recovered"/);
});
