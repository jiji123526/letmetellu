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
            return {
              async all() { return { results: [] }; },
            };
          },
        };
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

  assert.equal(calls.length, 1);
  const threadCall = calls[0];
  assert.doesNotMatch(threadCall.query, /WITH RECURSIVE/);
  assert.match(threadCall.query, /UNION ALL/);
  assert.match(threadCall.query, /channel_id = \? AND id IN \(\?, \?\)/);
  assert.match(threadCall.query, /channel_id = \?[\s\S]*reply_to IN \(\?, \?\)[\s\S]*deleted = 0/);
  assert.deepEqual(threadCall.params, [
    "channel-a", "root-a", "root-d",
    "channel-a", "root-a", "root-d",
  ]);
});
