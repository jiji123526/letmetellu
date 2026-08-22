import assert from "node:assert/strict";
import test from "node:test";
import { queueChannelNotification } from "../src/lib/notification-events.ts";
import type { Env } from "../src/types.ts";

function createEnv(ownerOnly = false) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const call = { sql, params: [] as unknown[] };
      calls.push(call);
      return {
        bind(...params: unknown[]) {
          call.params = params;
          return this;
        },
        async first() {
          return calls.length === 1
            ? { id: "test-room", name: "Test", owner_uid: "owner-1", passcode: null }
            : null;
        },
        async all() {
          return { results: [] };
        },
      };
    },
    async batch() {
      assert.fail("an empty recipient set must not write an outbox row");
    },
  };
  return {
    calls,
    env: {
      DB: db,
      INTERNAL_SECRET: "test-secret",
    } as unknown as Env,
    ownerOnly,
  };
}

test("member message fanout uses All mode and can include the owner", async () => {
  const { env, calls } = createEnv();
  assert.equal(await queueChannelNotification({
    env,
    channelId: "test-room",
    event: "channel_message",
    eventId: "message-1",
    actorUserId: "member-1",
    includeOwner: true,
    memberImportance: "all",
    bundle: true,
  }), 0);
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /pref\.mode = 'all'/);
  assert.match(calls[1].sql, /1 = 1/);
  assert.deepEqual(calls[1].params, ["test-room", "member-1"]);
});

test("important owner fanout is owner-scoped and actor-excluding", async () => {
  const { env, calls } = createEnv(true);
  assert.equal(await queueChannelNotification({
    env,
    channelId: "test-room",
    event: "dm",
    eventId: "dm-1",
    actorUserId: "member-1",
    ownerOnly: true,
    memberImportance: "important",
  }), 0);
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /pref\.user_id = \?/);
  assert.match(calls[1].sql, /pref\.mode IN \('important', 'all'\)/);
  assert.deepEqual(calls[1].params, ["test-room", "owner-1", "member-1"]);
});

