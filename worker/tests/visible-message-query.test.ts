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
  assert.match(threadCall.query, /WITH requested_roots\(id\) AS \(VALUES \(\?\), \(\?\)\)/);
  assert.match(threadCall.query, /requested_roots\.id = messages\.id/);
  assert.match(threadCall.query, /requested_roots\.id = messages\.reply_to/);
  assert.deepEqual(threadCall.params, [
    "root-a", "root-d", "channel-a", "channel-a",
  ]);
});

test("a full page of unique roots stays below the D1 variable limit", async () => {
  let boundParameterCount = 0;
  const env = {
    DB: {
      prepare() {
        return {
          bind(...params: unknown[]) {
            boundParameterCount = params.length;
            return { async all() { return { results: [] }; } };
          },
        };
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

  assert.equal(boundParameterCount, 52);
  assert.ok(boundParameterCount < 100);
});
