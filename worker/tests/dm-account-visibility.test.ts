import assert from "node:assert/strict";
import test from "node:test";
import { readDmThreads } from "../src/lib/dm-threads.ts";

function createEnv() {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const env = {
    DB: {
      prepare(query: string) {
        return {
          bind(...params: unknown[]) {
            calls.push({ query, params });
            return {
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    },
  };
  return { env: env as never, calls };
}

test("legacy DM reads match a signed-in visitor by device or account", async () => {
  const { env, calls } = createEnv();
  await readDmThreads(env, "channel-a", {
    owner: false,
    anonymousUid: "device-b",
    accountUid: "account-a",
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].query, /FROM dm_notification_owners notification_owner/);
  assert.match(calls[0].query, /notification_owner\.user_id = \?/);
  assert.deepEqual(calls[0].params, ["channel-a", "device-b", "account-a"]);
});

test("legacy guest DM reads remain device-bound", async () => {
  const { env, calls } = createEnv();
  await readDmThreads(env, "channel-a", {
    owner: false,
    anonymousUid: "device-b",
    accountUid: null,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].query, /AND uid = \?/);
  assert.doesNotMatch(calls[0].query, /dm_notification_owners/);
  assert.deepEqual(calls[0].params, ["channel-a", "device-b"]);
});
