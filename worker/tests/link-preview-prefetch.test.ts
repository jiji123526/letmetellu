import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { extractMessagePreviewUrls } from "../src/lib/preview-urls.ts";

const messageEmbedsSource = readFileSync(
  new URL("../../src/components/chat/MessageEmbeds.tsx", import.meta.url),
  "utf8",
);
const globalStylesSource = readFileSync(
  new URL("../../src/app/globals.css", import.meta.url),
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
    /window\.addEventListener\("chat-history-mounted", replenishMountedPreviewPrefetch\)/,
  );
  assert.match(
    messageEmbedsSource,
    /target\?\.addEventListener\("chat-history-preview-activate"/,
  );
  assert.match(
    messageEmbedsSource,
    /data-message-preview-url=\{url\}\s*data-history-layout-pending/,
  );
  assert.match(
    messageEmbedsSource,
    /mountedPrefetchBudget = Math\.max\([\s\S]*MOUNTED_PREVIEW_PREFETCH_LIMIT/,
  );
  assert.match(messageEmbedsSource, /readyPreviewImages/);
  assert.match(messageEmbedsSource, /function PreviewImage\(/);
  assert.match(messageEmbedsSource, /function PreviewVideo\(/);
  assert.match(messageEmbedsSource, /className="link-preview-skeleton"/);
  assert.match(messageEmbedsSource, /className="preview-media-skeleton"/);
  assert.match(messageEmbedsSource, /image\.decode\(\)/);
  assert.match(messageEmbedsSource, /PREVIEW_IMAGE_LOAD_TIMEOUT_MS = 12_000/);
  assert.match(messageEmbedsSource, /PREVIEW_CACHE_NAME = "letmetellu-link-previews-v8"/);
  assert.match(messageEmbedsSource, /window\.caches\.delete\(cacheName\)/);
  assert.match(messageEmbedsSource, /previewImageRequests\.delete\(data\.image\)/);
  assert.match(messageEmbedsSource, /referrerPolicy="no-referrer"/);
  assert.match(messageEmbedsSource, /<PreviewImage\s+key=\{data\.image\}/);
  const previewImageSource = messageEmbedsSource.slice(
    messageEmbedsSource.indexOf("function PreviewImage("),
    messageEmbedsSource.indexOf("function PreviewVideo("),
  );
  const visibleImageLoadHandler = previewImageSource.slice(
    previewImageSource.indexOf("onLoad={(event) =>"),
    previewImageSource.indexOf("onError={() =>"),
  );
  assert.ok(
    visibleImageLoadHandler.indexOf("setLoaded(true)")
      < visibleImageLoadHandler.indexOf("image.decode()"),
  );
  assert.doesNotMatch(
    visibleImageLoadHandler,
    /image\.decode\(\)[\s\S]*finally\([\s\S]*setLoaded\(true\)/,
  );
  assert.match(globalStylesSource, /\.link-preview-skeleton/);
  assert.match(globalStylesSource, /\.preview-media-skeleton/);
  assert.match(
    globalStylesSource,
    /\[data-bubble\]:has\(\.message-embeds\)\s*\{[\s\S]*width: calc\(320px \+ var\(--bubble-font-size\) \* 1\.176\);[\s\S]*max-width: 100%/,
  );
  assert.match(
    globalStylesSource,
    /\[data-bubble\]:has\(\.message-embeds\) \.link-preview-card,[\s\S]*width: 100% !important/,
  );
  assert.match(messageEmbedsSource, /className="link-preview-card"[\s\S]*width: "100%"/);
});

test("successful sends warm previews without delaying acknowledgement", () => {
  const waitUntilWarm = messageRouteSource.indexOf(
    "ctx.waitUntil(warmPreviewCache(request, text as string | undefined))",
  );
  const response = messageRouteSource.indexOf(
    "return withMessageTiming(",
  );
  assert.ok(waitUntilWarm >= 0);
  assert.ok(response > waitUntilWarm);
  assert.match(
    workerSource,
    /warmMessagePreviewCache\(sourceRequest, env, text\)/,
  );
});
