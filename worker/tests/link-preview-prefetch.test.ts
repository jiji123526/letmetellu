import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { extractMessagePreviewUrls } from "../src/lib/preview-urls.ts";

const messageEmbedsSource = readFileSync(
  new URL("../../src/components/chat/MessageEmbeds.tsx", import.meta.url),
  "utf8",
);
const messageRouteSource = readFileSync(
  new URL("../src/routes/messages.ts", import.meta.url),
  "utf8",
);
const workerSource = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);

test("message preview warming deduplicates, cleans and caps URLs", () => {
  assert.deepEqual(
    extractMessagePreviewUrls(
      "https://one.example/a. https://one.example/a https://two.example/b! https://three.example/c",
    ),
    ["https://one.example/a", "https://two.example/b"],
  );
});

test("mounted preview prefetch is bounded and connection-aware", () => {
  assert.match(messageEmbedsSource, /MAX_CONCURRENT_PREVIEW_REQUESTS = 2/);
  assert.match(messageEmbedsSource, /MOUNTED_PREVIEW_PREFETCH_LIMIT = 6/);
  assert.match(messageEmbedsSource, /requestIdleCallback/);
  assert.match(messageEmbedsSource, /saveData/);
  assert.match(messageEmbedsSource, /effectiveType\?\.includes\("2g"\)/);
  assert.match(messageEmbedsSource, /return "240px"/);
  assert.match(messageEmbedsSource, /effectiveType === "3g"\) return "720px"/);
  assert.match(messageEmbedsSource, /return "1440px"/);
  assert.match(messageEmbedsSource, /rootMargin: getEmbedPreviewRootMargin\(\)/);
  assert.match(messageEmbedsSource, /mountedPreviewDistance\(left\) - mountedPreviewDistance\(right\)/);
  assert.match(messageEmbedsSource, /priority: "visible" \| "background"/);
  assert.match(messageEmbedsSource, /previewSubscribers/);
  assert.match(messageEmbedsSource, /preloadPreviewImage\(cached\.data\)/);
  assert.match(messageEmbedsSource, /preloadPreviewImage\(result\)/);
  assert.match(messageEmbedsSource, /subscribeToPreview\(url/);
  assert.match(messageEmbedsSource, /window\.addEventListener\("chat-history-preload"/);
  assert.match(
    messageEmbedsSource,
    /mountedPrefetchBudget = Math\.max\([\s\S]*MOUNTED_PREVIEW_PREFETCH_LIMIT/,
  );
});

test("successful sends warm previews without delaying acknowledgement", () => {
  const waitUntilWarm = messageRouteSource.indexOf(
    "ctx.waitUntil(warmPreviewCache(request, text as string | undefined))",
  );
  const response = messageRouteSource.indexOf(
    "return Response.json({ id, created_at, message: newMessage })",
  );
  assert.ok(waitUntilWarm >= 0);
  assert.ok(response > waitUntilWarm);
  assert.match(
    workerSource,
    /warmMessagePreviewCache\(sourceRequest, env, text\)/,
  );
});
