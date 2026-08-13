import assert from "node:assert/strict";
import test from "node:test";

import { expandVisibleRootThreads } from "../src/lib/visible-messages.ts";

test("flat thread expansion uses direct root and child index lookups", async () => {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const env = {
    DB: {
      prepare(query: string) {
        return {
          bind(...params: unknown[]) {
            calls.push({ query, params });
            return { query, params };
          },
        };
      },
      async batch() {
        return [{ results: [] }, { results: [] }];
      },
    },
  };

  await expandVisibleRootThreads(
    env as never,
    "channel-a",
    [
      { id: "root-a", reply_to: null, created_at: "2026-08-09T00:00:00.000Z" },
      { id: "reply-b", reply_to: "root-a", created_at: "2026-08-09T00:01:00.000Z" },
      { id: "reply-c", reply_to: "root-a", created_at: "2026-08-09T00:02:00.000Z" },
      { id: "root-d", reply_to: null, created_at: "2026-08-09T00:03:00.000Z" },
    ],
  );

  assert.equal(calls.length, 2);
  const [rootCall, childCall] = calls;
  assert.doesNotMatch(rootCall.query + childCall.query, /WITH requested_roots|UNION ALL/);
  assert.match(rootCall.query, /channel_id = \?[\s\S]*id IN \(\?, \?\)/);
  assert.match(childCall.query, /channel_id = \?[\s\S]*reply_to IN \(\?, \?\)[\s\S]*deleted = 0/);
  assert.deepEqual(rootCall.params, ["channel-a", "root-a", "root-d"]);
  assert.deepEqual(childCall.params, ["channel-a", "root-a", "root-d"]);
});

test("each full-page thread lookup stays below the D1 variable limit", async () => {
  const boundParameterCounts: number[] = [];
  const env = {
    DB: {
      prepare() {
        return {
          bind(...params: unknown[]) {
            boundParameterCounts.push(params.length);
            return {};
          },
        };
      },
      async batch() {
        return [{ results: [] }, { results: [] }];
      },
    },
  };

  await expandVisibleRootThreads(
    env as never,
    "channel-a",
    Array.from({ length: 50 }, (_, index) => ({
      id: `root-${index}`,
      reply_to: null,
      created_at: `2026-08-09T00:00:${String(index).padStart(2, "0")}.000Z`,
    })),
  );

  assert.deepEqual(boundParameterCounts, [51, 51]);
  assert.ok(boundParameterCounts.every((count) => count < 100));
});

test("flat thread expansion merges and sorts batched roots and children", async () => {
  const env = {
    DB: {
      prepare() {
        return { bind() { return {}; } };
      },
      async batch() {
        return [
          { results: [{ id: "root-a", reply_to: null, created_at: "2026-08-09T00:00:00.000Z" }] },
          { results: [{ id: "reply-b", reply_to: "root-a", created_at: "2026-08-09T00:01:00.000Z" }] },
        ];
      },
    },
  };

  const messages = await expandVisibleRootThreads(
    env as never,
    "channel-a",
    [{ id: "reply-b", reply_to: "root-a", created_at: "2026-08-09T00:01:00.000Z" }],
  );

  assert.deepEqual(messages.map((message) => message.id), ["root-a", "reply-b"]);
});
