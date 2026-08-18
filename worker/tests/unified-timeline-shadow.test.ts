import assert from "node:assert/strict";
import test from "node:test";
import { createAnonymousIdentity } from "../src/lib/anonymous-identity.ts";
import { compareUnifiedTimelineShadow } from "../src/lib/unified-timeline-shadow.ts";
import { resolveUnifiedTimelineViewer } from "../src/lib/unified-timeline-viewer.ts";

const env = { INTERNAL_SECRET: "test-internal-secret" } as never;

test("shadow viewer accepts only a signed anonymous identity", async () => {
  const identity = await createAnonymousIdentity(env, "visitor-a");
  const verified = await resolveUnifiedTimelineViewer(new Request("https://example.test", {
    headers: { "X-Anonymous-Token": identity.token },
  }), env, false);
  assert.deepEqual(verified, { owner: false, anonymousUid: "visitor-a" });

  const forged = await resolveUnifiedTimelineViewer(new Request(
    "https://example.test?uid=visitor-a",
    { headers: { "X-Anonymous-Token": `${identity.token}tampered` } },
  ), env, false);
  assert.equal(forged, null);
});

test("owner shadow viewer does not require an anonymous token", async () => {
  assert.deepEqual(
    await resolveUnifiedTimelineViewer(new Request("https://example.test"), env, true),
    { owner: true },
  );
});

test("shadow comparison checks the same bounded merged root window", () => {
  const comparison = compareUnifiedTimelineShadow({
    publicMessages: [
      { id: "m1", created_at: "2026-08-17T00:00:00.000Z", reply_to: null },
      { id: "m1-r", created_at: "2026-08-17T09:00:00.000Z", reply_to: "m1" },
      { id: "m3", created_at: "2026-08-17T02:00:00.000Z", reply_to: null },
    ] as never,
    dmMessages: [
      { id: "d2", created_at: "2026-08-17T01:00:00.000Z", reply_to: null },
      { id: "d2-r", created_at: "2026-08-17T08:00:00.000Z", reply_to: "d2" },
    ] as never,
    unifiedPage: {
      items: [
        { id: "m1", source: "message", visual_root_created_at: "2026-08-17T00:00:00.000Z", visual_root_id: "m1", visual_depth: 0, created_at: "2026-08-17T00:00:00.000Z" },
        { id: "m1-r", source: "message", visual_root_created_at: "2026-08-17T00:00:00.000Z", visual_root_id: "m1", visual_depth: 1, created_at: "2026-08-17T09:00:00.000Z" },
        { id: "d2", source: "dm", visual_root_created_at: "2026-08-17T01:00:00.000Z", visual_root_id: "d2", visual_depth: 0, created_at: "2026-08-17T01:00:00.000Z" },
        { id: "m3", source: "message", visual_root_created_at: "2026-08-17T02:00:00.000Z", visual_root_id: "m3", visual_depth: 0, created_at: "2026-08-17T02:00:00.000Z" },
      ],
      hasMore: false,
      pageStartCursor: null,
      pageEndCursor: null,
      rootCount: 3,
    },
    limit: 3,
  });
  assert.equal(comparison.matches, true);
  assert.equal(comparison.firstMismatchIndex, null);
});

test("shadow mismatch metadata never contains message bodies or identity tokens", () => {
  const comparison = compareUnifiedTimelineShadow({
    publicMessages: [{ id: "m1", text: "private body", created_at: "2026-08-17T00:00:00.000Z", reply_to: null }] as never,
    dmMessages: [{ id: "d1", text: "secret dm", uid: "visitor-secret", created_at: "2026-08-17T01:00:00.000Z", reply_to: null }] as never,
    unifiedPage: {
      items: [],
      hasMore: false,
      pageStartCursor: null,
      pageEndCursor: null,
      rootCount: 0,
    },
    limit: 50,
  });
  const serialized = JSON.stringify(comparison);
  assert.doesNotMatch(serialized, /private body|secret dm|visitor-secret/);
  assert.equal(comparison.matches, false);
});
