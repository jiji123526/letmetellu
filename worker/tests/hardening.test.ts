import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getRateLimitBucketStart } from "../src/lib/durable-rate-limit.ts";
import { getCleanupRetryDelayMs, parseCleanupMediaKeys } from "../src/lib/cleanup-policy.ts";
import { matchesImageSignature } from "../src/lib/image-signature.ts";
import { getMediaCacheControl } from "../src/lib/media-cache-control.ts";
import {
  getOperationalRouteDetail,
  getOperationalErrorDetail,
  normalizeOperationalRoute,
  OPERATIONAL_EVENT_OVERRIDE_HEADER,
  getOperationalEventOverride,
  stripOperationalEventHeaders,
  withOperationalErrorContext,
  withOperationalEventOverride,
} from "../src/lib/operational-events.ts";
import {
  canUsePublicBackgroundCache,
  createPublicBackgroundCacheKey,
} from "../src/lib/public-background-cache.ts";
import {
  deriveOperationalHealthStatus,
  OPERATIONAL_HEALTH_THRESHOLDS,
  serializeOperationalHealthWindow,
} from "../src/lib/operational-health.ts";
import { parsePreviewMetadata } from "../src/lib/preview-metadata.ts";
import { getPreviewFailureCacheTtl } from "../src/lib/preview-cache-policy.ts";
import { assertAllowedPreviewUrl, isBlockedPreviewHostname, PreviewError } from "../src/lib/preview-policy.ts";
import { buildManagedMediaPath, extractMediaKey, normalizeManagedMediaUrl } from "../src/lib/media.ts";
import { extractYouTubeVideoId } from "../src/lib/youtube-preview.ts";

function expectPreviewError(fn: () => unknown, message: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof PreviewError, `expected PreviewError for ${message}`);
  assert.equal((thrown as PreviewError).message, message);
  assert.equal((thrown as PreviewError).status, 400);
}

test("getRateLimitBucketStart floors timestamps into the active window", () => {
  assert.equal(getRateLimitBucketStart(0, 10_000), 0);
  assert.equal(getRateLimitBucketStart(9_999, 10_000), 0);
  assert.equal(getRateLimitBucketStart(10_000, 10_000), 10_000);
  assert.equal(getRateLimitBucketStart(19_001, 10_000), 10_000);
});

test("cleanup retries use bounded exponential backoff", () => {
  assert.equal(getCleanupRetryDelayMs(0), 60_000);
  assert.equal(getCleanupRetryDelayMs(1), 60_000);
  assert.equal(getCleanupRetryDelayMs(2), 120_000);
  assert.equal(getCleanupRetryDelayMs(10), 30_720_000);
  assert.equal(getCleanupRetryDelayMs(20), 24 * 60 * 60 * 1000);
});

test("cleanup media snapshots reject corruption and deduplicate valid keys", () => {
  const oversized = "x".repeat(1025);
  assert.deepEqual(
    parseCleanupMediaKeys(JSON.stringify(["room/a.jpg", "room/a.jpg", "room/b.png"])),
    ["room/a.jpg", "room/b.png"],
  );
  assert.throws(
    () => parseCleanupMediaKeys(JSON.stringify(["room/a.jpg", oversized])),
    /invalid cleanup media snapshot/,
  );
  assert.throws(() => parseCleanupMediaKeys("{}"), /invalid cleanup media snapshot/);
  assert.throws(() => parseCleanupMediaKeys("invalid"), /invalid cleanup media snapshot/);
});

test("isBlockedPreviewHostname rejects internal and local hosts", () => {
  [
    "localhost",
    "api.localhost",
    "service.local",
    "admin.internal",
    "metadata.google.internal",
    "router.home.arpa",
    "127.0.0.1",
    "10.0.0.7",
    "172.16.1.10",
    "192.168.0.8",
    "[::1]",
    "intranet",
  ].forEach((hostname) => {
    assert.equal(isBlockedPreviewHostname(hostname), true, hostname);
  });
});

test("assertAllowedPreviewUrl accepts normal public http and https URLs", () => {
  const httpsUrl = assertAllowedPreviewUrl("https://example.com/path?q=1");
  assert.equal(httpsUrl.hostname, "example.com");
  assert.equal(httpsUrl.protocol, "https:");

  const httpUrl = assertAllowedPreviewUrl("http://news.example.org/story");
  assert.equal(httpUrl.hostname, "news.example.org");
  assert.equal(httpUrl.protocol, "http:");
});

test("assertAllowedPreviewUrl rejects malformed or unsafe URLs", () => {
  expectPreviewError(() => assertAllowedPreviewUrl("not a url"), "invalid url");
  expectPreviewError(() => assertAllowedPreviewUrl("ftp://example.com/file"), "unsupported url scheme");
  expectPreviewError(() => assertAllowedPreviewUrl("https://user:pass@example.com"), "credentials not allowed");
  expectPreviewError(() => assertAllowedPreviewUrl("https://127.0.0.1/admin"), "blocked preview host");
  expectPreviewError(() => assertAllowedPreviewUrl("https://[::1]/"), "blocked preview host");
});

test("preview metadata supports standard title fallback and relative images", () => {
  assert.deepEqual(parsePreviewMetadata(`
    <html>
      <head>
        <title>Legacy &amp; Article</title>
        <meta name="description" content="Older page description">
        <meta property="og:image" content="/images/card.jpg">
      </head>
    </html>
  `, "https://www.example.com/posts/1"), {
    title: "Legacy & Article",
    description: "Older page description",
    image: "https://www.example.com/images/card.jpg",
    video: "",
    siteName: "example.com",
  });
});

test("preview metadata prefers Open Graph values", () => {
  const metadata = parsePreviewMetadata(`
    <title>Document title</title>
    <meta content="Open Graph title" property="og:title">
    <meta property="og:site_name" content="Example News">
    <meta property="og:video" content="https://cdn.example.com/video.mp4">
  `, "https://example.com/story");

  assert.equal(metadata.title, "Open Graph title");
  assert.equal(metadata.siteName, "Example News");
  assert.equal(metadata.video, "https://cdn.example.com/video.mp4");
});

test("preview failure cache distinguishes stable and transient upstream failures", () => {
  assert.equal(getPreviewFailureCacheTtl(400), 15 * 60);
  assert.equal(getPreviewFailureCacheTtl(415), 15 * 60);
  assert.equal(getPreviewFailureCacheTtl(502), 60);
  assert.equal(getPreviewFailureCacheTtl(504), 60);
  assert.equal(getPreviewFailureCacheTtl(429), null);
  assert.equal(getPreviewFailureCacheTtl(500), null);
});

test("YouTube preview IDs support common share, live and reordered watch URLs", () => {
  assert.equal(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=test"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeVideoId("https://www.youtube.com/live/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeVideoId("https://www.youtube.com/watch?si=test&v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(extractYouTubeVideoId("https://youtube.com/watch?v=invalid"), null);
});

test("upload access and quota checks stay ahead of request-body consumption", () => {
  const source = readFileSync(new URL("../src/routes/upload.ts", import.meta.url), "utf8");
  const handlerStart = source.indexOf("export async function handleUpload");
  const identityCheck = source.indexOf("await verifyAnonymousIdentityToken", handlerStart);
  const quotaCheck = source.indexOf("await enforceUploadQuota", handlerStart);
  const bodyRead = source.indexOf("request.body.getReader()", handlerStart);

  assert.ok(handlerStart >= 0, "upload handler should exist");
  assert.ok(identityCheck > handlerStart, "upload handler should validate actor identity");
  assert.ok(quotaCheck > identityCheck, "upload handler should enforce quota after identity validation");
  assert.ok(bodyRead > quotaCheck, "upload body must not be consumed before access and quota checks");
});

test("matchesImageSignature accepts supported image headers", () => {
  assert.equal(matchesImageSignature("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(matchesImageSignature("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  assert.equal(matchesImageSignature("image/gif", new TextEncoder().encode("GIF87a")), true);
  assert.equal(matchesImageSignature("image/gif", new TextEncoder().encode("GIF89a")), true);
  assert.equal(matchesImageSignature("image/webp", new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ])), true);
});

test("matchesImageSignature rejects mismatched, truncated and unsupported content", () => {
  const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(matchesImageSignature("image/jpeg", pngHeader), false);
  assert.equal(matchesImageSignature("image/png", pngHeader.subarray(0, 4)), false);
  assert.equal(matchesImageSignature("image/gif", new TextEncoder().encode("<html>")), false);
  assert.equal(matchesImageSignature("application/octet-stream", pngHeader), false);
});

test("media cache policy keeps shared assets public and chat media browser-private", () => {
  assert.equal(
    getMediaCacheControl("channel-background", false),
    "public, max-age=300, s-maxage=3600, must-revalidate",
  );
  assert.equal(
    getMediaCacheControl("channel-background", true),
    "private, max-age=300, must-revalidate",
  );
  assert.equal(getMediaCacheControl("message", false), "private, max-age=300, must-revalidate");
  assert.equal(getMediaCacheControl("gallery", true), "private, max-age=300, must-revalidate");
  assert.equal(getMediaCacheControl("dm", true), "private, max-age=300, must-revalidate");
  assert.equal(getMediaCacheControl("channel-config", true), "private, no-store");
});

test("public background edge cache only accepts stable GET requests", () => {
  const request = new Request("https://worker.example/api/media/room/background.jpg");
  assert.equal(canUsePublicBackgroundCache(request), true);
  assert.equal(
    createPublicBackgroundCacheKey(request, "room/background.jpg").url,
    "https://worker.example/__public_background_cache/v1?key=room%2Fbackground.jpg",
  );
  assert.equal(
    canUsePublicBackgroundCache(new Request(`${request.url}?media_token=secret`)),
    false,
  );
  assert.equal(
    canUsePublicBackgroundCache(new Request(request.url, { method: "HEAD" })),
    false,
  );
});

test("managed media URLs normalize to one stable same-origin path", () => {
  const key = "zziks/09f9bdf8-da7c-4577-a343-a05cd32aacea.jpg";
  const stablePath = buildManagedMediaPath(key);
  const signedWorkerUrl = `https://letsplay-api.letmetellu.workers.dev${stablePath}?media_token=secret`;
  const sameOriginUrl = `https://yapndot.com${stablePath}`;

  assert.equal(normalizeManagedMediaUrl(stablePath), stablePath);
  assert.equal(normalizeManagedMediaUrl(`${stablePath}?media_token=secret`), stablePath);
  assert.equal(normalizeManagedMediaUrl(signedWorkerUrl), stablePath);
  assert.equal(normalizeManagedMediaUrl(sameOriginUrl), stablePath);
  assert.equal(extractMediaKey(signedWorkerUrl), key);
  assert.equal(extractMediaKey(stablePath), key);
});

test("operational health windows normalize D1 values and missing counts", () => {
  assert.deepEqual(serializeOperationalHealthWindow({
    tracked_event_count: "12",
    request_5xx_count: 2,
    preview_upstream_failure_count: "4",
    unhandled_exception_count: null,
    maintenance_failure_count: undefined,
    cleanup_failure_count: "2",
    realtime_failure_count: "3",
    rate_limited_count: "7",
    forbidden_count: 3,
    media_not_found_count: "9",
  }), {
    tracked_event_count: 12,
    request_5xx_count: 2,
    preview_upstream_failure_count: 4,
    unhandled_exception_count: 0,
    maintenance_failure_count: 0,
    cleanup_failure_count: 2,
    realtime_failure_count: 3,
    rate_limited_count: 7,
    forbidden_count: 3,
    media_not_found_count: 9,
  });
});

test("operational health status applies conservative 15-minute thresholds", () => {
  assert.deepEqual(OPERATIONAL_HEALTH_THRESHOLDS, {
    critical_15m: {
      request_5xx_count: 5,
      unhandled_exception_count: 3,
      maintenance_failure_count: 1,
    },
    degraded_15m: {
      request_5xx_count: 1,
      unhandled_exception_count: 1,
      cleanup_failure_count: 1,
      realtime_failure_count: 1,
      rate_limited_count: 25,
    },
  });
  const base = serializeOperationalHealthWindow(null);
  assert.equal(deriveOperationalHealthStatus(base), "healthy");
  assert.equal(deriveOperationalHealthStatus({ ...base, request_5xx_count: 1 }), "degraded");
  assert.equal(deriveOperationalHealthStatus({ ...base, preview_upstream_failure_count: 4 }), "healthy");
  assert.equal(deriveOperationalHealthStatus({ ...base, cleanup_failure_count: 1 }), "degraded");
  assert.equal(deriveOperationalHealthStatus({ ...base, realtime_failure_count: 1 }), "degraded");
  assert.equal(deriveOperationalHealthStatus({ ...base, rate_limited_count: 25 }), "degraded");
  assert.equal(deriveOperationalHealthStatus({ ...base, request_5xx_count: 5 }), "critical");
  assert.equal(deriveOperationalHealthStatus({ ...base, unhandled_exception_count: 3 }), "critical");
  assert.equal(deriveOperationalHealthStatus({ ...base, maintenance_failure_count: 1 }), "critical");
});

test("operational event overrides stay internal to Worker bookkeeping", () => {
  const response = withOperationalEventOverride(
    Response.json({ error: "fetch failed" }, { status: 502 }),
    "preview_upstream_failed",
  );
  assert.equal(getOperationalEventOverride(response), "preview_upstream_failed");

  const headers = new Headers(response.headers);
  stripOperationalEventHeaders(headers);
  assert.equal(headers.get(OPERATIONAL_EVENT_OVERRIDE_HEADER), null);
});

test("operational route normalization groups websocket channel paths", () => {
  assert.equal(normalizeOperationalRoute("get", "/ws/zziks"), "GET /ws/:channel");
  assert.equal(normalizeOperationalRoute("get", "/api/media/zziks/example.jpg"), "GET /api/media/:key");
  assert.equal(normalizeOperationalRoute("post", "/api/messages"), "POST /api/messages");
  assert.deepEqual(getOperationalRouteDetail("/ws/zziks"), {
    route_group: "websocket",
    request_channel_id: "zziks",
  });
  assert.deepEqual(getOperationalRouteDetail("/api/media/zziks/example.jpg"), {
    route_group: "media",
    request_channel_id: "zziks",
    request_media_key: "zziks/example.jpg",
  });
  assert.equal(getOperationalRouteDetail("/api/messages"), null);
});

test("operational error context merges route detail onto thrown errors", () => {
  const error = new Error("boom");
  const contextualized = withOperationalErrorContext(error, { route_stage: "load_channel" });
  assert.equal(contextualized, error);
  assert.deepEqual(getOperationalErrorDetail(contextualized), {
    route_stage: "load_channel",
  });

  withOperationalErrorContext(contextualized, {
    route_action: "send",
    request_channel_id: "room-1",
  });
  assert.deepEqual(getOperationalErrorDetail(contextualized), {
    route_stage: "load_channel",
    route_action: "send",
    request_channel_id: "room-1",
  });
});

test("init and messages routes keep operational error context instrumentation", () => {
  const initSource = readFileSync(new URL("../src/routes/init.ts", import.meta.url), "utf8");
  assert.match(initSource, /withOperationalErrorContext/);
  assert.match(initSource, /route_stage/);

  const messagesSource = readFileSync(new URL("../src/routes/messages.ts", import.meta.url), "utf8");
  assert.match(messagesSource, /withOperationalErrorContext/);
  assert.match(messagesSource, /route_action/);
  assert.match(messagesSource, /route_stage/);
});
