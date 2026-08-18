import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialChatTimelineState,
  replaceUnifiedTimelinePage,
  selectTimelineDmMessages,
  selectTimelineMessages,
  setChatTimelineMode,
  updateChatTimelineSource,
} from "../../src/components/chat/chatTimelineState.ts";
import { isUnifiedTimelineClientEnabled } from "../src/lib/unified-timeline-rollout.ts";
import type { Env } from "../src/types.ts";
import type { Message } from "../../src/components/chat/chatTypes.ts";

function message(
  id: string,
  createdAt: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    uid: "visitor-a",
    nick: null,
    text: id,
    is_admin: 0,
    image: null,
    reactions: "{}",
    reply_to: null,
    created_at: createdAt,
    ...overrides,
  };
}

test("legacy mode remains the default and keeps compatibility collections", () => {
  let state = createInitialChatTimelineState();
  state = updateChatTimelineSource(state, "message", [
    message("m1", "2026-08-18T00:00:00.000Z"),
  ]);
  state = updateChatTimelineSource(state, "dm", [
    message("d1", "2026-08-18T01:00:00.000Z", { dm: true }),
  ]);

  assert.equal(state.mode, "legacy");
  assert.deepEqual(selectTimelineMessages(state).map((item) => item.id), ["m1"]);
  assert.deepEqual(selectTimelineDmMessages(state).map((item) => item.id), ["d1"]);
});

test("unified mode uses source and id as canonical identity", () => {
  let state = createInitialChatTimelineState();
  state = updateChatTimelineSource(state, "message", [
    message("shared", "2026-08-18T00:00:00.000Z"),
  ]);
  state = updateChatTimelineSource(state, "dm", [
    message("shared", "2026-08-18T00:00:00.000Z", { dm: true }),
  ]);
  state = setChatTimelineMode(state, true);

  assert.equal(state.mode, "unified");
  assert.deepEqual(
    state.timelineItems.map((item) => `${item.source}:${item.id}`),
    ["message:shared", "dm:shared"],
  );
});

test("compatibility setters transact against one unified collection", () => {
  let state = setChatTimelineMode(createInitialChatTimelineState(), true);
  state = updateChatTimelineSource(state, "message", [
    message("root", "2026-08-18T00:00:00.000Z"),
    message("reply", "2026-08-18T02:00:00.000Z", { reply_to: "root" }),
  ]);
  state = updateChatTimelineSource(state, "dm", [
    message("dm-root", "2026-08-18T01:00:00.000Z", { dm: true }),
  ]);
  state = updateChatTimelineSource(state, "message", (previous) =>
    previous.filter((item) => item.id !== "reply")
  );

  assert.equal(state.mode, "unified");
  assert.deepEqual(
    state.timelineItems.map((item) => `${item.source}:${item.id}`),
    ["message:root", "dm:dm-root"],
  );
});

test("disabling the rollout converts unified state back to the legacy pair", () => {
  let state = setChatTimelineMode(createInitialChatTimelineState(), true);
  state = updateChatTimelineSource(state, "message", [
    message("m1", "2026-08-18T00:00:00.000Z"),
  ]);
  state = updateChatTimelineSource(state, "dm", [
    message("d1", "2026-08-18T01:00:00.000Z", { dm: true }),
  ]);
  state = setChatTimelineMode(state, false);

  assert.equal(state.mode, "legacy");
  assert.deepEqual(state.messages.map((item) => item.id), ["m1"]);
  assert.deepEqual(state.dmMessages.map((item) => item.id), ["d1"]);
});

test("unified page cursors remain opaque server-owned state", () => {
  const cursor = {
    visual_root_created_at: "2026-08-18T00:00:00.000Z",
    source: "message" as const,
    visual_root_id: "m1",
    visual_depth: 0 as const,
    created_at: "2026-08-18T00:00:00.000Z",
    id: "m1",
  };
  let state = setChatTimelineMode(createInitialChatTimelineState(), true);
  state = replaceUnifiedTimelinePage(state, [{
    ...message("m1", cursor.created_at),
    ...cursor,
  }], cursor, cursor);

  assert.equal(state.mode, "unified");
  assert.equal(state.pageStartCursor, cursor);
  assert.equal(state.pageEndCursor, cursor);
});

test("the server rollout defaults off and matches only exact channel IDs", () => {
  const disabled = {} as Env;
  assert.equal(isUnifiedTimelineClientEnabled(disabled, "room-a"), false);

  const enabled = {
    UNIFIED_TIMELINE_CHANNEL_ALLOWLIST: " room-a,room-b ",
  } as Env;
  assert.equal(isUnifiedTimelineClientEnabled(enabled, "room-a"), true);
  assert.equal(isUnifiedTimelineClientEnabled(enabled, "room"), false);
  assert.equal(isUnifiedTimelineClientEnabled(enabled, "room-c"), false);
  assert.equal(
    isUnifiedTimelineClientEnabled(enabled, "room-a", { live: true }),
    false,
  );
  assert.equal(
    isUnifiedTimelineClientEnabled(enabled, "room-a", { reports: true }),
    false,
  );
});
