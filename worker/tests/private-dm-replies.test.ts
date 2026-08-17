import assert from "node:assert/strict";
import test from "node:test";

import {
  getAnonymousViewerDmMessages,
  getDisplayMessages,
  getThreadedMessages,
} from "../../src/components/chat/chatMessageSelectors.ts";
import { canReplyToMessage } from "../../src/components/chat/messageActionRules.ts";
import type { Message } from "../../src/components/chat/chatTypes.ts";
import { createAnonymousIdentity } from "../src/lib/anonymous-identity.ts";
import { handleDm } from "../src/routes/dm.ts";
import type { Env } from "../src/types.ts";

const INTERNAL_SECRET = "private-dm-test-secret";
const CHANNEL_ID = "channel-a";
const OWNER_ID = "owner-a";
const SENDER_ID = "sender-a";

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function createFakeEnv(options: { dmOwner?: string; insertChanges?: number } = {}) {
  const writes: string[] = [];
  const broadcasts: Array<Record<string, unknown>> = [];
  const root = {
    id: "dm-a",
    client_message_id: "client-dm-a",
    uid: SENDER_ID,
    auth_uid: SENDER_ID,
    nick: null,
    text: "private question",
    image: null,
    channel_id: CHANNEL_ID,
    created_at: "2026-08-17T10:00:00.000Z",
  };

  function statement(sqlText: string, params: unknown[] = []) {
    const sql = normalizeSql(sqlText);
    return {
      bind(...nextParams: unknown[]) {
        return statement(sql, nextParams);
      },
      async first() {
        if (sql.includes("SELECT passcode, owner_uid FROM channels")) {
          return { passcode: null, owner_uid: OWNER_ID };
        }
        if (sql.includes("FROM dm JOIN channels")) {
          return {
            id: root.id,
            channel_id: root.channel_id,
            owner_uid: options.dmOwner || OWNER_ID,
          };
        }
        return null;
      },
      async all() {
        if (sql.includes("SELECT * FROM (SELECT * FROM dm")) {
          if (sql.includes("AND uid = ?") && params[1] !== SENDER_ID) return { results: [] };
          return { results: [root] };
        }
        if (sql.includes("FROM dm_replies WHERE dm_id IN")) return { results: [] };
        return { results: [] };
      },
      async run() {
        writes.push(`${sql} :: ${JSON.stringify(params)}`);
        return { success: true, meta: { changes: options.insertChanges ?? 1 } };
      },
    };
  }

  const env = {
    INTERNAL_SECRET,
    REPORTS_CHANNEL_ID: "reports",
    DB: {
      prepare: statement,
      async batch() {
        return [];
      },
    },
    CHAT_ROOM: {
      idFromName(name: string) {
        return name;
      },
      get() {
        return {
          async fetch(request: Request) {
            if (new URL(request.url).pathname.endsWith("/channel-rate-limit")) {
              return Response.json({ ok: true });
            }
            broadcasts.push(await request.json() as Record<string, unknown>);
            return Response.json({ ok: true });
          },
        };
      },
    },
  } as unknown as Env;

  return { env, writes, broadcasts };
}

function ownerRequest(body: Record<string, unknown>, headers: HeadersInit = {}): Request {
  return new Request("https://api.example.test/api/dm", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": INTERNAL_SECRET,
      "X-User-Id": OWNER_ID,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("forged owner headers cannot create a private DM reply", async () => {
  const { env, writes } = createFakeEnv();
  const response = await handleDm(ownerRequest({
    dm_id: "dm-a",
    client_reply_id: crypto.randomUUID(),
    text: "forged reply",
  }, {
    "X-Internal-Token": "wrong-secret",
  }), env);

  assert.equal(response.status, 401);
  assert.deepEqual(writes, []);
});

test("an owner cannot reply to another owner's DM", async () => {
  const { env, writes } = createFakeEnv({ dmOwner: "owner-b" });
  const response = await handleDm(ownerRequest({
    dm_id: "dm-a",
    client_reply_id: crypto.randomUUID(),
    text: "cross-owner reply",
  }), env);

  assert.equal(response.status, 403);
  assert.deepEqual(writes, []);
});

test("owner replies persist and broadcast only a content-free invalidation", async () => {
  const { env, writes, broadcasts } = createFakeEnv();
  const response = await handleDm(ownerRequest({
    dm_id: "dm-a",
    client_reply_id: crypto.randomUUID(),
    text: "private answer",
  }), env);
  const data = await response.json() as { reply?: Message };

  assert.equal(response.status, 200);
  assert.equal(data.reply?.reply_to, "dm-a");
  assert.equal(data.reply?.dm_reply, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(broadcasts, [{ type: "dm-threads-changed" }]);
  assert.doesNotMatch(JSON.stringify(broadcasts), /private answer|dm-a|sender-a/);
});

test("the conditional insert rejects a twenty-first owner reply", async () => {
  const { env, broadcasts } = createFakeEnv({ insertChanges: 0 });
  const response = await handleDm(ownerRequest({
    dm_id: "dm-a",
    client_reply_id: crypto.randomUUID(),
    text: "one reply too many",
  }), env);

  assert.equal(response.status, 409);
  assert.equal((await response.json() as { error?: string }).error, "dm_reply_limit");
  assert.deepEqual(broadcasts, []);
});

test("sender thread reads are scoped to the signed anonymous identity", async () => {
  const { env } = createFakeEnv();
  const sender = await createAnonymousIdentity(env, SENDER_ID);
  const response = await handleDm(new Request(
    `https://api.example.test/api/dm?channel=${CHANNEL_ID}`,
    { headers: { "X-Anonymous-Token": sender.token } },
  ), env);
  const data = await response.json() as { dm?: Message[] };

  assert.equal(response.status, 200);
  assert.deepEqual(data.dm?.map((message) => message.id), ["dm-a"]);

  const other = await createAnonymousIdentity(env, "other-sender");
  const otherResponse = await handleDm(new Request(
    `https://api.example.test/api/dm?channel=${CHANNEL_ID}`,
    { headers: { "X-Anonymous-Token": other.token } },
  ), env);
  assert.deepEqual((await otherResponse.json() as { dm?: Message[] }).dm, []);
});

test("private threads render for the sender but only owners can reply", () => {
  const root = {
    id: "dm-a",
    uid: SENDER_ID,
    nick: null,
    text: "question",
    is_admin: 0,
    image: null,
    reactions: "{}",
    reply_to: null,
    created_at: "2026-08-17T10:00:00.000Z",
    dm: true,
  } satisfies Message;
  const reply = {
    ...root,
    id: "reply-a",
    uid: OWNER_ID,
    text: "answer",
    is_admin: 1,
    reply_to: root.id,
    created_at: "2026-08-17T10:01:00.000Z",
    dm_reply: true,
  } satisfies Message;

  const displayed = getDisplayMessages([], [root, reply], false, false, null);
  const threaded = getThreadedMessages(displayed);
  assert.deepEqual(threaded.topLevel.map((message) => message.id), [root.id]);
  assert.deepEqual(threaded.repliesMap[root.id].map((message) => message.id), [reply.id]);
  assert.equal(canReplyToMessage(root, false), false);
  assert.equal(canReplyToMessage(root, true), true);

  const foreignRoot = { ...root, id: "dm-b", uid: "sender-b" };
  const foreignReply = { ...reply, id: "reply-b", reply_to: foreignRoot.id };
  assert.deepEqual(
    getAnonymousViewerDmMessages([root, reply, foreignRoot, foreignReply], SENDER_ID)
      .map((message) => message.id),
    [root.id, reply.id],
  );
});
