import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getRateLimitBucketStart } from "../src/lib/durable-rate-limit.ts";
import { assertAllowedPreviewUrl, isBlockedPreviewHostname, PreviewError } from "../src/lib/preview-policy.ts";

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
