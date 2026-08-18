import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(
  new URL("../../src/app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const supportApiSource = readFileSync(
  new URL("../../src/lib/api-support.ts", import.meta.url),
  "utf8",
);

test("support deletion invalidates stale previews and confirms server state", () => {
  assert.match(dashboardSource, /supportPreviewRequestGenerationRef/);
  assert.match(dashboardSource, /supportPreviewDeletingRef\.current/);
  assert.match(
    dashboardSource,
    /requestGeneration !== supportPreviewRequestGenerationRef\.current/,
  );
  assert.match(
    dashboardSource,
    /const refreshRequest = loadSupportPreview\(\)[\s\S]*await refreshRequest/,
  );
});

test("support close survives immediate navigation when the browser permits it", () => {
  assert.match(
    supportApiSource,
    /export async function closeSupportThread[\s\S]*keepalive: true[\s\S]*action: "close_thread"/,
  );
});
