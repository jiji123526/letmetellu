import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workerIndex = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);

const workerRoute = readFileSync(
  new URL("../src/routes/global-notice.ts", import.meta.url),
  "utf8",
);

const nextProxy = readFileSync(
  new URL("../../src/app/api/global-notice/route.ts", import.meta.url),
  "utf8",
);

const dashboardSource = readFileSync(
  new URL("../../src/app/dashboard/page.tsx", import.meta.url),
  "utf8",
);

const providersSource = readFileSync(
  new URL("../../src/components/Providers.tsx", import.meta.url),
  "utf8",
);

const rootLayoutSource = readFileSync(
  new URL("../../src/app/layout.tsx", import.meta.url),
  "utf8",
);

const gateSource = readFileSync(
  new URL("../../src/components/GlobalNoticeGate.tsx", import.meta.url),
  "utf8",
);

const editorSource = readFileSync(
  new URL("../../src/components/dashboard/GlobalNoticeEditorDialog.tsx", import.meta.url),
  "utf8",
);

test("worker routes include the global notice endpoint", () => {
  assert.match(workerIndex, /handleGlobalNotice/);
  assert.match(workerIndex, /url\.pathname\.startsWith\("\/api\/global-notice"\)/);
});

test("global notice writes require trusted platform-admin identity", () => {
  assert.match(workerRoute, /const userId = getTrustedUserId\(request, env\)/);
  assert.match(workerRoute, /if \(!await isPlatformAdmin\(userId, env\)\)/);
  assert.match(workerRoute, /GLOBAL_NOTICE_CONFIG_ID = "global_notice_dialog"/);
  assert.match(workerRoute, /GLOBAL_NOTICE_CHANNEL_ID = "__global__"/);
});

test("global notice values are bounded and versioned", () => {
  assert.match(workerRoute, /MAX_GLOBAL_NOTICE_TITLE_LENGTH = 120/);
  assert.match(workerRoute, /MAX_GLOBAL_NOTICE_BODY_LENGTH = 2_000/);
  assert.match(workerRoute, /version: new Date\(\)\.toISOString\(\)/);
});

test("next proxy keeps reads public and forwards writes through the internal identity path", () => {
  assert.match(nextProxy, /export async function GET\(\)/);
  assert.match(nextProxy, /fetch\(`\$\{workerUrl\}\/api\/global-notice`/);
  assert.match(nextProxy, /s-maxage=300/);
  assert.match(nextProxy, /must-revalidate/);
  assert.doesNotMatch(nextProxy, /stale-while-revalidate/);
  assert.match(nextProxy, /export async function POST\(request: Request\)/);
  assert.match(nextProxy, /"X-Internal-Token": process\.env\.INTERNAL_SECRET \|\| ""/);
  assert.match(nextProxy, /"X-User-Id": session\.user\.id/);
  assert.match(nextProxy, /export async function DELETE\(\)/);
});

test("the editor stays admin-only while the notice gate covers every entry route", () => {
  assert.match(dashboardSource, /setGlobalNotice\(await fetchGlobalNotice\(\)\)/);
  assert.match(dashboardSource, /setShowGlobalNoticeEditor\(true\)/);
  assert.match(dashboardSource, /isPlatformAdmin && \(/);
  assert.match(rootLayoutSource, /<RootProviders>/);
  assert.match(providersSource, /export function RootProviders/);
  assert.match(providersSource, /<GlobalNoticeGate \/>/);
  assert.doesNotMatch(gateSource, /isDashboardPath/);
  assert.match(gateSource, /const pathname = usePathname\(\)/);
  assert.match(gateSource, /\[loadNotice, pathname\]/);
  assert.match(gateSource, /status === "loading"/);
  assert.match(gateSource, /yap_global_notice_seen_/);
  assert.match(gateSource, /notice\.version/);
  assert.match(gateSource, /fetchGlobalNotice\(\)/);
  assert.match(
    readFileSync(new URL("../../src/lib/api-global-notice.ts", import.meta.url), "utf8"),
    /GLOBAL_NOTICE_BROWSER_CACHE_TTL_MS = 60 \* 60 \* 1_000/,
  );
  assert.match(editorSource, /GlobalNoticeSurface/);
  assert.match(editorSource, /useState<"current" \| "compose" \| "preview">\(notice \? "current" : "compose"\)/);
  assert.match(editorSource, /onClick=\{\(\) => void onClear\(\)\}/);
  assert.match(editorSource, /t\("globalNoticeEdit"\)/);
});
