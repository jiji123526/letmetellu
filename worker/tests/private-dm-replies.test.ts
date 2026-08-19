import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

function createFakeEnv(options: {
  dmOwner?: string;
  insertChanges?: number;
  uploadTicket?: { id: string; key: string };
  replyMedia?: Array<{ id: string; image: string | null }>;
  threadReplies?: Array<Record<string, unknown>>;
} = {}) {
  const writes: string[] = [];
  const broadcasts: Array<Record<string, unknown>> = [];
  const mediaDeletes: string[] = [];
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
        if (sql.includes("SELECT id, image FROM dm WHERE id = ? AND channel_id = ? AND uid = ?")) {
          return params[0] === root.id && params[1] === root.channel_id && params[2] === root.uid
            ? { id: root.id, image: root.image }
            : null;
        }
        if (sql.includes("FROM dm JOIN channels")) {
          return {
            id: root.id,
            channel_id: root.channel_id,
            owner_uid: options.dmOwner || OWNER_ID,
          };
        }
        if (sql.includes("FROM upload_tickets")) {
          return options.uploadTicket
            ? {
                id: options.uploadTicket.id,
                uid: OWNER_ID,
                auth_uid: OWNER_ID,
                key: options.uploadTicket.key,
              }
            : null;
        }
        return null;
      },
      async all() {
        if (sql.includes("SELECT id, client_message_id, uid, auth_uid, nick, text, image, channel_id, created_at FROM (SELECT id, client_message_id, uid, auth_uid, nick, text, image, channel_id, created_at FROM dm")) {
          if (sql.includes("AND uid = ?") && params[1] !== SENDER_ID) return { results: [] };
          return { results: [root] };
        }
        if (sql.includes("FROM dm_replies WHERE dm_id IN")) {
          return { results: options.threadReplies || [] };
        }
        if (sql.includes("SELECT id, image FROM dm_replies WHERE dm_id = ?")) {
          return { results: options.replyMedia || [] };
        }
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
      async batch(statements: Array<{ run: () => Promise<unknown> }>) {
        return Promise.all(statements.map((item) => item.run()));
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
    MEDIA: {
      async delete(key: string) {
        mediaDeletes.push(key);
      },
    },
  } as unknown as Env;

  return { env, writes, broadcasts, mediaDeletes };
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

async function senderDeleteRequest(
  env: Env,
  senderUid: string,
  dmId = "dm-a",
): Promise<Request> {
  const sender = await createAnonymousIdentity(env, senderUid);
  return new Request("https://api.example.test/api/dm", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "X-Anonymous-Token": sender.token,
    },
    body: JSON.stringify({ dm_id: dmId, channel_id: CHANNEL_ID }),
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

test("an owner can send one image-only private reply with a bound upload ticket", async () => {
  const uploadKey = `${CHANNEL_ID}/reply.jpg`;
  const { env, writes, broadcasts } = createFakeEnv({
    uploadTicket: { id: "upload-a", key: uploadKey },
  });
  const response = await handleDm(ownerRequest({
    dm_id: "dm-a",
    client_reply_id: crypto.randomUUID(),
    text: "",
    image: `https://api.example.test/api/media/${uploadKey}`,
    upload_id: "upload-a",
  }), env);
  const data = await response.json() as { reply?: Message };

  assert.equal(response.status, 200);
  assert.equal(data.reply?.image, `https://api.example.test/api/media/${uploadKey}`);
  assert.ok(writes.some((write) => write.includes("INSERT INTO dm_replies")));
  assert.ok(writes.some((write) =>
    write.includes("UPDATE upload_tickets")
    && write.includes(`["${data.reply?.id}","dm","upload-a"]`)
  ));
  assert.deepEqual(broadcasts, [{ type: "dm-threads-changed" }]);
});

test("an image private reply requires a valid upload ticket", async () => {
  const { env, writes, broadcasts } = createFakeEnv();
  const response = await handleDm(ownerRequest({
    dm_id: "dm-a",
    client_reply_id: crypto.randomUUID(),
    text: "photo",
    image: `https://api.example.test/api/media/${CHANNEL_ID}/reply.jpg`,
  }), env);

  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error?: string }).error, "invalid_upload_ticket");
  assert.deepEqual(writes, []);
  assert.deepEqual(broadcasts, []);
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

test("sender thread reads include the owner's private reply image", async () => {
  const image = `https://api.example.test/api/media/${CHANNEL_ID}/reply.jpg`;
  const { env } = createFakeEnv({
    threadReplies: [{
      id: "reply-a",
      client_reply_id: "client-reply-a",
      dm_id: "dm-a",
      channel_id: CHANNEL_ID,
      owner_uid: OWNER_ID,
      text: "",
      image,
      created_at: "2026-08-17T10:01:00.000Z",
    }],
  });
  const sender = await createAnonymousIdentity(env, SENDER_ID);
  const response = await handleDm(new Request(
    `https://api.example.test/api/dm?channel=${CHANNEL_ID}`,
    { headers: { "X-Anonymous-Token": sender.token } },
  ), env);
  const data = await response.json() as { dm?: Message[] };

  assert.equal(response.status, 200);
  assert.equal(data.dm?.find((message) => message.id === "reply-a")?.image, image);
});

test("the original sender can delete their DM root and its private replies", async () => {
  const { env, writes, broadcasts, mediaDeletes } = createFakeEnv({
    replyMedia: [{
      id: "reply-a",
      image: `https://api.example.test/api/media/${CHANNEL_ID}/reply.jpg`,
    }],
  });
  const response = await handleDm(await senderDeleteRequest(env, SENDER_ID), env);

  assert.equal(response.status, 200);
  assert.equal((await response.json() as { ok?: boolean }).ok, true);
  assert.ok(writes.some((write) => write.includes("DELETE FROM dm_replies WHERE dm_id = ?")));
  assert.ok(writes.some((write) =>
    write.includes("DELETE FROM dm WHERE id = ? AND channel_id = ? AND uid = ?")
  ));
  assert.ok(writes.some((write) => write.includes("DELETE FROM upload_tickets")));
  assert.ok(writes.some((write) => write.includes('["dm","reply-a"]')));
  assert.deepEqual(mediaDeletes, [`${CHANNEL_ID}/reply.jpg`]);
  assert.deepEqual(broadcasts, [
    { type: "dm-deleted", dm_id: "dm-a" },
    { type: "dm-threads-changed" },
  ]);
  assert.doesNotMatch(JSON.stringify(broadcasts), /private question|sender-a/);
});

test("another anonymous identity cannot delete a sender's DM", async () => {
  const { env, writes, broadcasts } = createFakeEnv();
  const response = await handleDm(await senderDeleteRequest(env, "other-sender"), env);

  assert.equal(response.status, 404);
  assert.deepEqual(writes, []);
  assert.deepEqual(broadcasts, []);
});

test("sender deletion rejects an owner reply id and an unsigned request", async () => {
  const { env, writes, broadcasts } = createFakeEnv();
  const replyResponse = await handleDm(
    await senderDeleteRequest(env, SENDER_ID, "reply-a"),
    env,
  );
  const unsignedResponse = await handleDm(new Request("https://api.example.test/api/dm", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dm_id: "dm-a", channel_id: CHANNEL_ID }),
  }), env);

  assert.equal(replyResponse.status, 404);
  assert.equal(unsignedResponse.status, 401);
  assert.deepEqual(writes, []);
  assert.deepEqual(broadcasts, []);
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

test("DM replies inherit their parent bubble side", () => {
  const messageListSource = readFileSync(
    new URL("../../src/components/chat/ChatMessageList.tsx", import.meta.url),
    "utf8",
  );
  assert.match(messageListSource, /const isSent = isReply\s*\?\s*parentIsSent\s*:\s*fallbackIsSent/);
});

test("the owner composer allows one DM reply image and submits its upload ticket", () => {
  const mutationSource = readFileSync(
    new URL("../../src/components/chat/useChatMessageMutations.ts", import.meta.url),
    "utf8",
  );
  const shellSource = readFileSync(
    new URL("../../src/components/chat/ChatViewBottomShell.tsx", import.meta.url),
    "utf8",
  );

  assert.match(mutationSource, /pendingPhotos\.length > 1/);
  assert.match(mutationSource, /uploadAdminImage\(photos\[0\]\.blob, replyChannelId, "dm"\)/);
  assert.match(mutationSource, /image: upload\?\.url/);
  assert.match(mutationSource, /upload_id: upload\?\.uploadId/);
  assert.match(
    mutationSource,
    /if \(!result\?\.ok \|\| !result\.reply\)[\s\S]*return;[\s\S]*clearReplyingTo\(\)/,
  );
  assert.match(shellSource, /multiple=\{allowMultiplePhotos\}/);
});

test("sender DM roots expose deletion without unsupported reaction controls", () => {
  const actionsSource = readFileSync(
    new URL("../../src/components/chat/useChatContextMenuActions.ts", import.meta.url),
    "utf8",
  );
  const mutationSource = readFileSync(
    new URL("../../src/components/chat/useChatMessageMutations.ts", import.meta.url),
    "utf8",
  );
  const contextMenuSource = readFileSync(
    new URL("../../src/components/chat/ContextMenu.tsx", import.meta.url),
    "utf8",
  );
  const messageListSource = readFileSync(
    new URL("../../src/components/chat/ChatMessageList.tsx", import.meta.url),
    "utf8",
  );
  const pendingDeletionSource = readFileSync(
    new URL("../src/lib/pending-admin-deletions.ts", import.meta.url),
    "utf8",
  );

  assert.match(actionsSource, /!effectiveAdmin[\s\S]*contextMenu\.isOwn[\s\S]*contextMenu\.msg\.dm[\s\S]*!contextMenu\.msg\.dm_reply/);
  assert.match(actionsSource, /effectiveAdmin[\s\S]*contextMenu\.isOwn[\s\S]*contextMenu\.msg\.dm[\s\S]*contextMenu\.msg\.dm_reply/);
  assert.match(mutationSource, /targetDm\?\.dm[\s\S]*!targetDm\.dm_reply[\s\S]*targetDm\.uid === uid/);
  assert.match(mutationSource, /deleteDm\(\{[\s\S]*dm_id: messageId/);
  assert.match(mutationSource, /targetMessage\?\.dm_reply[\s\S]*adminAction\("delete-dm-reply"/);
  assert.match(contextMenuSource, /\{!msg\.dm && !isReportInboxMessage/);
  assert.match(messageListSource, /\{!msg\.dm && \(\s*<div>\s*<ReactionBadge/);
  assert.match(pendingDeletionSource, /stageDmReplyDeletion[\s\S]*WHERE id = \? AND channel_id = \? AND owner_uid = \?/);
});
