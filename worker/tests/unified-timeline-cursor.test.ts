import assert from "node:assert/strict";
import test from "node:test";
import {
  UNIFIED_TIMELINE_MAX_PAGE_SIZE,
  UNIFIED_TIMELINE_PAGE_SIZE,
  clampUnifiedTimelinePageSize,
  compareUnifiedTimelineCursor,
  parseUnifiedTimelineCursor,
  type UnifiedTimelineCursor,
} from "../src/lib/unified-timeline.ts";

function cursor(overrides: Partial<UnifiedTimelineCursor> = {}): UnifiedTimelineCursor {
  return {
    visual_root_created_at: "2026-08-17T00:00:00.000Z",
    source: "message",
    visual_root_id: "root-a",
    visual_depth: 0,
    created_at: "2026-08-17T00:00:00.000Z",
    id: "message-a",
    ...overrides,
  };
}

test("unified timeline cursors keep roots before their replies", () => {
  const root = cursor();
  const reply = cursor({
    visual_depth: 1,
    created_at: "2026-08-17T01:00:00.000Z",
    id: "reply-a",
  });
  assert.ok(compareUnifiedTimelineCursor(root, reply) < 0);
});

test("unified timeline cursors deterministically order different sources", () => {
  const message = cursor({ source: "message", id: "shared-id" });
  const dm = cursor({ source: "dm", id: "shared-id" });
  assert.ok(compareUnifiedTimelineCursor(message, dm) < 0);
  assert.ok(compareUnifiedTimelineCursor(dm, message) > 0);
});

test("unified timeline cursors use IDs as the final stable tie breaker", () => {
  assert.ok(compareUnifiedTimelineCursor(cursor({ id: "a" }), cursor({ id: "b" })) < 0);
});

test("unified timeline cursor parsing rejects partial or unknown cursor shapes", () => {
  assert.deepEqual(parseUnifiedTimelineCursor(cursor()), cursor());
  assert.equal(parseUnifiedTimelineCursor({ ...cursor(), source: "report" }), null);
  assert.equal(parseUnifiedTimelineCursor({ ...cursor(), visual_depth: 2 }), null);
  assert.equal(parseUnifiedTimelineCursor({ ...cursor(), visual_root_id: "" }), null);
});

test("unified timeline page sizes remain bounded", () => {
  assert.equal(clampUnifiedTimelinePageSize(undefined), UNIFIED_TIMELINE_PAGE_SIZE);
  assert.equal(clampUnifiedTimelinePageSize(-1), UNIFIED_TIMELINE_PAGE_SIZE);
  assert.equal(clampUnifiedTimelinePageSize(25), 25);
  assert.equal(clampUnifiedTimelinePageSize(10_000), UNIFIED_TIMELINE_MAX_PAGE_SIZE);
});
