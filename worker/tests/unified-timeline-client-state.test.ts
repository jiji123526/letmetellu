import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createInitialChatTimelineState,
  mergeUnifiedTimelineLatestPage,
  mergeUnifiedTimelinePage,
  removeChatTimelineThread,
  replaceUnifiedTimelinePage,
  restoreChatTimelineItems,
  selectTimelineDmMessages,
  selectTimelineMessages,
  setChatTimelineMode,
  updateChatTimelineSource,
  upsertChatTimelineItems,
} from "../../src/components/chat/chatTimelineState.ts";
import { readSelectedBootstrap } from "../src/lib/bootstrap-read-mode.ts";
import {
  getUnifiedTimelineRolloutBucket,
  isUnifiedTimelineClientEnabled,
  resolveUnifiedTimelineRollout,
} from "../src/lib/unified-timeline-rollout.ts";
import type { Env } from "../src/types.ts";
import type { Message } from "../../src/components/chat/chatTypes.ts";
import { shareInFlightRequest } from "../../src/components/chat/chatSingleFlight.ts";

const apiChatSource = readFileSync(
  new URL("../../src/lib/api-chat.ts", import.meta.url),
  "utf8",
);
const historyNavigationSource = readFileSync(
  new URL("../../src/components/chat/useChatHistoryNavigation.ts", import.meta.url),
  "utf8",
);

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

test("acknowledgement and realtime replay converge on one source-qualified item", () => {
  let state = setChatTimelineMode(createInitialChatTimelineState(), true);
  state = upsertChatTimelineItems(state, "message", [
    message("optimistic", "2026-08-18T00:00:00.000Z", {
      client_message_id: "send-1",
    }),
  ]);
  state = upsertChatTimelineItems(state, "message", [
    message("server", "2026-08-18T00:00:01.000Z", {
      client_message_id: "send-1",
    }),
  ]);
  state = upsertChatTimelineItems(state, "message", [
    message("server", "2026-08-18T00:00:01.000Z", {
      client_message_id: "send-1",
    }),
  ]);

  assert.equal(state.mode, "unified");
  assert.deepEqual(state.timelineItems.map((item) => item.id), ["server"]);
});

test("source-qualified thread deletion removes its children but not a colliding DM", () => {
  let state = setChatTimelineMode(createInitialChatTimelineState(), true);
  state = upsertChatTimelineItems(state, "message", [
    message("shared", "2026-08-18T00:00:00.000Z"),
    message("public-reply", "2026-08-18T00:00:01.000Z", { reply_to: "shared" }),
  ]);
  state = upsertChatTimelineItems(state, "dm", [
    message("shared", "2026-08-18T00:00:00.000Z", { dm: true }),
    message("dm-reply", "2026-08-18T00:00:02.000Z", {
      dm: true,
      dm_reply: true,
      reply_to: "shared",
    }),
  ]);
  state = removeChatTimelineThread(state, "message", "shared");

  assert.equal(state.mode, "unified");
  assert.deepEqual(
    state.timelineItems.map((item) => `${item.source}:${item.id}`),
    ["dm:shared", "dm:dm-reply"],
  );
});

test("undo restoration is ordered and idempotent", () => {
  const root = message("root", "2026-08-18T00:00:00.000Z");
  const reply = message("reply", "2026-08-18T00:00:01.000Z", {
    reply_to: "root",
  });
  const restored = [
    { source: "message" as const, message: root },
    { source: "message" as const, message: reply },
  ];
  let state = setChatTimelineMode(createInitialChatTimelineState(), true);
  state = restoreChatTimelineItems(state, restored);
  state = restoreChatTimelineItems(state, restored);

  assert.equal(state.mode, "unified");
  assert.deepEqual(state.timelineItems.map((item) => item.id), ["root", "reply"]);
});

test("public edits cannot mutate a DM with the same database id", () => {
  let state = setChatTimelineMode(createInitialChatTimelineState(), true);
  state = upsertChatTimelineItems(state, "message", [
    message("shared", "2026-08-18T00:00:00.000Z", { text: "public" }),
  ]);
  state = upsertChatTimelineItems(state, "dm", [
    message("shared", "2026-08-18T00:00:00.000Z", { dm: true, text: "private" }),
  ]);
  state = updateChatTimelineSource(state, "message", (previous) =>
    previous.map((item) => item.id === "shared" ? { ...item, text: "edited" } : item)
  );

  assert.equal(selectTimelineMessages(state)[0].text, "edited");
  assert.equal(selectTimelineDmMessages(state)[0].text, "private");
});

test("concurrent content-free invalidations share one refresh and application", async () => {
  const holder = { current: null as Promise<number> | null };
  let starts = 0;
  let applications = 0;
  const refresh = () => shareInFlightRequest(holder, async () => {
    starts += 1;
    await Promise.resolve();
    applications += 1;
    return applications;
  });

  const first = refresh();
  const second = refresh();
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(starts, 1);
  assert.equal(applications, 1);

  await refresh();
  assert.equal(starts, 2);
  assert.equal(applications, 2);
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

test("latest unified snapshots replace their window and retain older mounted roots", () => {
  const oldCursor = {
    visual_root_created_at: "2026-08-18T00:00:00.000Z",
    source: "message" as const,
    visual_root_id: "old",
    visual_depth: 0 as const,
    created_at: "2026-08-18T00:00:00.000Z",
    id: "old",
  };
  const latestCursor = {
    ...oldCursor,
    visual_root_created_at: "2026-08-18T01:00:00.000Z",
    visual_root_id: "latest",
    created_at: "2026-08-18T01:00:00.000Z",
    id: "latest",
  };
  let state = setChatTimelineMode(createInitialChatTimelineState(), true);
  state = replaceUnifiedTimelinePage(state, [
    { ...message("old", oldCursor.created_at), ...oldCursor },
    { ...message("latest", latestCursor.created_at), ...latestCursor },
    {
      ...message("stale-reply", "2026-08-18T02:00:00.000Z", { reply_to: "latest" }),
      ...latestCursor,
      id: "stale-reply",
      created_at: "2026-08-18T02:00:00.000Z",
      visual_depth: 1,
    },
  ], oldCursor, latestCursor, false);
  state = mergeUnifiedTimelineLatestPage(state, [{
    ...message("latest", latestCursor.created_at, { text: "updated" }),
    ...latestCursor,
  }], latestCursor, latestCursor, true);

  assert.equal(state.mode, "unified");
  assert.deepEqual(state.timelineItems.map((item) => item.id), ["old", "latest"]);
  assert.equal(state.timelineItems[1].text, "updated");
  assert.equal(state.pageStartCursor, oldCursor);
  assert.equal(state.pageEndCursor, latestCursor);
});

test("bootstrap selection executes one reader and never falls back in-request", async () => {
  const calls: string[] = [];
  const unified = await readSelectedBootstrap(true, {
    legacy: async () => {
      calls.push("legacy");
      return "legacy";
    },
    unified: async () => {
      calls.push("unified");
      return "unified";
    },
  });
  assert.deepEqual(unified, { mode: "unified", value: "unified" });
  assert.deepEqual(calls, ["unified"]);

  await assert.rejects(() => readSelectedBootstrap(true, {
    legacy: async () => {
      calls.push("fallback");
      return "legacy";
    },
    unified: async () => {
      throw new Error("unified failed");
    },
  }), /unified failed/);
  assert.equal(calls.includes("fallback"), false);
});

test("bidirectional unified pages merge once and retain server edge state", () => {
  const first = {
    visual_root_created_at: "2026-08-18T01:00:00.000Z",
    source: "message" as const,
    visual_root_id: "m1",
    visual_depth: 0 as const,
    created_at: "2026-08-18T01:00:00.000Z",
    id: "m1",
  };
  const older = {
    ...first,
    visual_root_created_at: "2026-08-18T00:00:00.000Z",
    visual_root_id: "d0",
    created_at: "2026-08-18T00:00:00.000Z",
    id: "d0",
    source: "dm" as const,
  };
  let state = setChatTimelineMode(createInitialChatTimelineState(), true);
  state = replaceUnifiedTimelinePage(
    state,
    [{ ...message("m1", first.created_at), ...first }],
    first,
    first,
    true,
    false,
  );
  state = mergeUnifiedTimelinePage(
    state,
    "before",
    [{ ...message("d0", older.created_at, { dm: true }), ...older }],
    older,
    older,
    false,
  );

  assert.equal(state.mode, "unified");
  assert.deepEqual(state.timelineItems.map((item) => `${item.source}:${item.id}`), [
    "dm:d0",
    "message:m1",
  ]);
  assert.equal(state.pageStartCursor, older);
  assert.equal(state.pageEndCursor, first);
  assert.equal(state.hasMoreBefore, false);
  assert.equal(state.hasMoreAfter, false);
});

test("prepending a unified page preserves mounted DM object references", () => {
  const dmCursor = {
    visual_root_created_at: "2026-08-18T01:00:00.000Z",
    source: "dm" as const,
    visual_root_id: "dm-current",
    visual_depth: 0 as const,
    created_at: "2026-08-18T01:00:00.000Z",
    id: "dm-current",
  };
  const existingDm = {
    ...message("dm-current", dmCursor.created_at, {
      dm: true,
      image: "/api/media/room/dm.jpg",
    }),
    ...dmCursor,
  };
  const olderCursor = {
    ...dmCursor,
    source: "message" as const,
    visual_root_created_at: "2026-08-18T00:00:00.000Z",
    visual_root_id: "message-older",
    created_at: "2026-08-18T00:00:00.000Z",
    id: "message-older",
  };
  let state = setChatTimelineMode(createInitialChatTimelineState(), true);
  state = replaceUnifiedTimelinePage(
    state,
    [existingDm],
    dmCursor,
    dmCursor,
    true,
    false,
  );
  assert.equal(state.mode, "unified");
  const mountedDm = state.timelineItems[0];

  state = mergeUnifiedTimelinePage(
    state,
    "before",
    [{ ...message("message-older", olderCursor.created_at), ...olderCursor }],
    olderCursor,
    olderCursor,
    false,
  );

  assert.equal(state.mode, "unified");
  assert.equal(state.timelineItems[1], mountedDm);
  assert.equal(state.timelineItems[1], existingDm);
});

test("unified prepend holds its viewport anchor while inserted media settles", () => {
  const unifiedPrepend = historyNavigationSource.match(
    /if \(unifiedTimelineEnabled && unifiedStartCursorRef\.current\) \{([\s\S]*?)setIsOlderHistoryLoading\(true\);/,
  )?.[1] || "";

  assert.match(unifiedPrepend, /holdViewportPosition\(/);
  assert.match(unifiedPrepend, /anchorMessageId: anchor\.id/);
  assert.match(unifiedPrepend, /applyUnifiedHistoryPage\(/);
  assert.match(unifiedPrepend, /waitForCompleteHistoryWindow\(/);
  assert.match(unifiedPrepend, /releaseHeldViewport\?\.\(\)/);
  assert.ok(
    unifiedPrepend.indexOf("holdViewportPosition(")
      < unifiedPrepend.indexOf("applyUnifiedHistoryPage("),
  );
});

test("unified history trimming remains bounded and keeps whole root groups", () => {
  const items = Array.from({ length: 305 }, (_, index) => {
    const id = `m-${String(index).padStart(3, "0")}`;
    const createdAt = `2026-08-18T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`;
    return {
      ...message(id, createdAt),
      source: "message" as const,
      visual_root_created_at: createdAt,
      visual_root_id: id,
      visual_depth: 0 as const,
    };
  });
  let state = setChatTimelineMode(createInitialChatTimelineState(), true);
  state = replaceUnifiedTimelinePage(state, items.slice(0, 200), null, null);
  state = mergeUnifiedTimelinePage(state, "after", items.slice(200), null, null, false);

  assert.equal(state.mode, "unified");
  assert.equal(state.timelineItems.length, 300);
  assert.equal(state.timelineItems[0].id, "m-005");
  assert.equal(state.timelineItems.at(-1)?.id, "m-304");
  assert.equal(state.hasMoreBefore, true);
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
    isUnifiedTimelineClientEnabled({
      UNIFIED_TIMELINE_LIVE_CHANNEL_ALLOWLIST: "room-a",
    } as Env, "room-a", { live: true }),
    true,
  );
  assert.equal(
    isUnifiedTimelineClientEnabled(enabled, "room-a", { reports: true }),
    false,
  );
  assert.equal(
    isUnifiedTimelineClientEnabled({
      UNIFIED_TIMELINE_LIVE_CHANNEL_ALLOWLIST: "reports",
    } as Env, "reports", { reports: true }),
    false,
  );
  assert.equal(
    isUnifiedTimelineClientEnabled({
      UNIFIED_TIMELINE_REPORTS_CHANNEL_ALLOWLIST: "reports",
    } as Env, "reports", { reports: true }),
    true,
  );
});

test("normal percentage rollout is deterministic and special channels ignore it", () => {
  const salt = "stable-rollout-v1";
  const channelIds = Array.from({ length: 1_000 }, (_, index) => `room-${index}`);
  const sampled = channelIds.filter((channelId) =>
    isUnifiedTimelineClientEnabled({
      UNIFIED_TIMELINE_SAMPLE_PERCENT: "5",
      UNIFIED_TIMELINE_SAMPLE_SALT: salt,
    } as Env, channelId)
  );

  assert.ok(sampled.length >= 35 && sampled.length <= 65);
  assert.deepEqual(
    sampled,
    channelIds.filter((channelId) =>
      isUnifiedTimelineClientEnabled({
        UNIFIED_TIMELINE_SAMPLE_PERCENT: "5.0",
        UNIFIED_TIMELINE_SAMPLE_SALT: salt,
      } as Env, channelId)
    ),
  );
  assert.equal(
    isUnifiedTimelineClientEnabled({
      UNIFIED_TIMELINE_SAMPLE_PERCENT: "100",
      UNIFIED_TIMELINE_SAMPLE_SALT: salt,
    } as Env, "room-a"),
    true,
  );
  assert.equal(
    isUnifiedTimelineClientEnabled({
      UNIFIED_TIMELINE_SAMPLE_PERCENT: "100",
      UNIFIED_TIMELINE_SAMPLE_SALT: salt,
    } as Env, "room-a", { live: true }),
    false,
  );
  assert.equal(
    isUnifiedTimelineClientEnabled({
      UNIFIED_TIMELINE_SAMPLE_PERCENT: "100",
      UNIFIED_TIMELINE_SAMPLE_SALT: salt,
    } as Env, "reports", { reports: true }),
    false,
  );
});

test("percentage rollout fails closed without valid percent and salt", () => {
  for (const percent of ["", "0", "-1", "101", "5%", "five"]) {
    assert.equal(
      isUnifiedTimelineClientEnabled({
        UNIFIED_TIMELINE_SAMPLE_PERCENT: percent,
        UNIFIED_TIMELINE_SAMPLE_SALT: "salt",
      } as Env, "room-a"),
      false,
    );
  }
  assert.equal(
    isUnifiedTimelineClientEnabled({
      UNIFIED_TIMELINE_SAMPLE_PERCENT: "100",
    } as Env, "room-a"),
    false,
  );
});

test("exact allowlists override a channel outside the sampled cohort", () => {
  const salt = "stable-rollout-v1";
  const outsideChannel = Array.from({ length: 1_000 }, (_, index) => `outside-${index}`)
    .find((channelId) => getUnifiedTimelineRolloutBucket(channelId, salt) >= 500);
  assert.ok(outsideChannel);

  const decision = resolveUnifiedTimelineRollout({
    UNIFIED_TIMELINE_CHANNEL_ALLOWLIST: outsideChannel,
    UNIFIED_TIMELINE_SAMPLE_PERCENT: "5",
    UNIFIED_TIMELINE_SAMPLE_SALT: salt,
  } as Env, outsideChannel!);
  assert.deepEqual(decision, {
    enabled: true,
    mode: "allowlist",
    bucket: null,
  });
});

test("a disabled unified endpoint reloads an open tab into legacy mode once", () => {
  assert.match(
    apiChatSource,
    /response\.status === 409 && payload\?\.error === "unified_timeline_disabled"/,
  );
  assert.match(
    apiChatSource,
    /UNIFIED_ROLLBACK_RELOAD_GUARD_MS = 30_000/,
  );
  assert.match(
    apiChatSource,
    /window\.setTimeout\(\(\) => window\.location\.reload\(\), 0\)/,
  );
});
