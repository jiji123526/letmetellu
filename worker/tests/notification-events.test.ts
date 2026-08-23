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

test("reply notification is targeted and uses Important mode", async () => {
  const { env, calls } = createEnv();

  assert.equal(await queueChannelNotification({
    env,
    channelId: "test-room",
    event: "message_reply",
    eventId: "reply-1",
    actorUserId: "member-2",
    recipientUserId: "member-1",
    memberImportance: "important",
  }), 0);

  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /pref\.user_id = \?/);
  assert.match(
    calls[1].sql,
    /pref\.mode IN \('important', 'all'\)/,
  );
  assert.deepEqual(
    calls[1].params,
    ["test-room", "member-1", "member-2"],
  );
});

test("normal message fanout excludes the reply recipient", async () => {
  const { env, calls } = createEnv();

  assert.equal(await queueChannelNotification({
    env,
    channelId: "test-room",
    event: "channel_message",
    eventId: "reply-1",
    actorUserId: "member-2",
    includeOwner: true,
    memberImportance: "all",
    excludeUserId: "member-1",
  }), 0);

  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls[1].params,
    ["test-room", "member-2", "member-1"],
  );
});

test("owner reply recipient receives reply notification instead of duplicate owner message", async () => {
  const normal = createEnv();

  assert.equal(await queueChannelNotification({
    env: normal.env,
    channelId: "test-room",
    event: "channel_message",
    eventId: "reply-by-owner-1",
    actorUserId: "owner-1",
    memberImportance: "important",
    includeOwner: false,
    excludeUserId: "member-1",
  }), 0);

  assert.equal(normal.calls.length, 2);

  // owner-1 is already excluded by the normal owner-message fanout clause,
  // so it must not be bound a second time as actorUserId.
  assert.deepEqual(
    normal.calls[1].params,
    ["test-room", "owner-1", "member-1"],
  );

  const reply = createEnv();

  assert.equal(await queueChannelNotification({
    env: reply.env,
    channelId: "test-room",
    event: "message_reply",
    eventId: "reply-by-owner-1",
    actorUserId: "owner-1",
    recipientUserId: "member-1",
    memberImportance: "important",
  }), 0);

  assert.equal(reply.calls.length, 2);
  assert.deepEqual(
    reply.calls[1].params,
    ["test-room", "member-1", "owner-1"],
  );
});
