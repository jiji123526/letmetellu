import assert from "node:assert/strict";
import test from "node:test";

import { expandVisibleRootThreads } from "../src/lib/visible-messages.ts";

test("thread expansion computes visible deleted parents once", async () => {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const env = {
    DB: {
      prepare(query: string) {
        return {
          bind(...params: unknown[]) {
            calls.push({ query, params });
            return {
              async all() {
                if (calls.length === 1) {
                  return { results: [{ seed_id: "seed", id: "root", depth: 1 }] };
                }
                return { results: [] };
              },
            };
          },
        };
      },
    },
  };

  await expandVisibleRootThreads(
    env as never,
    "channel-a",
    [{ id: "seed", created_at: "2026-08-09T00:00:00.000Z" }],
  );

  assert.equal(calls.length, 2);
  const threadCall = calls[1];
  assert.match(threadCall.query, /WITH RECURSIVE visible_reply_parents\(id\) AS/);
  assert.equal(threadCall.query.match(/SELECT DISTINCT reply_to/g)?.length, 1);
  assert.equal(threadCall.query.match(/SELECT id FROM visible_reply_parents/g)?.length, 2);
  assert.deepEqual(threadCall.params, ["channel-a", "root", "channel-a", "channel-a"]);
});
