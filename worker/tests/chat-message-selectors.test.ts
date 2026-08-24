import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getDisplayMessages,
  getThreadedMessages,
} from "../../src/components/chat/chatMessageSelectors.ts";
import type { Message } from "../../src/components/chat/chatTypes.ts";

const selectorSource = readFileSync(
  new URL("../../src/components/chat/chatMessageSelectors.ts", import.meta.url),
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

test("normal display order linearly merges already sorted message sources", () => {
  const messages = [
    message("m1", "2026-08-19T00:00:00.000Z"),
    message("m2", "2026-08-19T02:00:00.000Z"),
  ];
  const dmMessages = [
    message("d1", "2026-08-19T01:00:00.000Z", { dm: true }),
    message("d2", "2026-08-19T02:00:00.000Z", { dm: true }),
  ];

  assert.deepEqual(
    getDisplayMessages(messages, dmMessages, false, false, null).map((item) => item.id),
    ["m1", "d1", "m2", "d2"],
  );

  const displaySource = selectorSource.slice(
    selectorSource.indexOf("export function getDisplayMessages"),
    selectorSource.indexOf("export function getRestrictedChannels"),
  );
  assert.match(displaySource, /mergeChronologicalMessages\(/);
});

test("unified display preserves canonical timeline order across context paging", () => {
  const messages = [
    message("m1", "2026-08-19T01:00:00.000Z"),
    message("m2", "2026-08-19T02:00:00.000Z"),
  ];
  const dmMessages = [
    message("d-old", "2026-08-18T00:00:00.000Z", { dm: true }),
    message("d-old-r", "2026-08-19T03:00:00.000Z", {
      dm: true,
      dm_reply: true,
      reply_to: "d-old",
    }),
  ];

  // The DM root is chronologically old, but the unified reader has already
  // positioned its thread after m2 because of recent DM activity.
  const canonicalTimeline = [
    messages[0],
    messages[1],
    dmMessages[0],
    dmMessages[1],
  ];

  assert.deepEqual(
    getDisplayMessages(
      messages,
      dmMessages,
      true,
      false,
      null,
      "context",
      canonicalTimeline,
    ).map((item) => item.id),
    ["m1", "m2", "d-old", "d-old-r"],
  );
});

test("display ordering falls back safely when a source arrives unsorted", () => {
  const messages = [
    message("m2", "2026-08-19T02:00:00.000Z"),
    message("m1", "2026-08-19T00:00:00.000Z"),
  ];
  const dmMessages = [
    message("d1", "2026-08-19T01:00:00.000Z", { dm: true }),
  ];

  assert.deepEqual(
    getDisplayMessages(messages, dmMessages, true, false, null).map((item) => item.id),
    ["m1", "d1", "m2"],
  );
});

test("thread grouping reuses its message map for nested reply roots", () => {
  const root = message("root", "2026-08-19T00:00:00.000Z");
  const reply = message("reply", "2026-08-19T00:01:00.000Z", {
    reply_to: root.id,
  });
  const nestedReply = message("nested", "2026-08-19T00:02:00.000Z", {
    reply_to: reply.id,
  });

  const threaded = getThreadedMessages([root, reply, nestedReply]);
  assert.deepEqual(threaded.topLevel.map((item) => item.id), ["root"]);
  assert.deepEqual(threaded.repliesMap[root.id].map((item) => item.id), [
    "reply",
    "nested",
  ]);
  assert.doesNotMatch(selectorSource, /const messageIds = new Set\(displayMessages/);
});
