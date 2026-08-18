import assert from "node:assert/strict";
import test from "node:test";
import {
  readUnifiedTimelineContextPage,
  readUnifiedTimelinePage,
} from "../src/lib/unified-timeline-reader.ts";

interface QueryCall {
  query: string;
  params: unknown[];
}

function createEnv(input: {
  messageRoots?: Array<Record<string, unknown>>;
  dmRoots?: Array<Record<string, unknown>>;
  messageReplies?: Array<Record<string, unknown>>;
  dmReplies?: Array<Record<string, unknown>>;
}) {
  const calls: QueryCall[] = [];
  const result = (rows: Array<Record<string, unknown>>) => ({
    results: rows,
    meta: {
      rows_read: rows.length,
      duration: rows.length / 10,
    },
  });
  const DB = {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ query, params });
          return {
            async first() {
              if (query.includes("SELECT d.* FROM dm d")) {
                return input.dmRoots?.[0] || null;
              }
              if (query.includes("WITH RECURSIVE ancestors")) {
                return input.messageRoots?.[0] || null;
              }
              return null;
            },
            async all() {
              if (query.includes("SELECT d.* FROM dm d")) return result(input.dmRoots || []);
              if (query.includes("FROM dm_replies")) return result(input.dmReplies || []);
              if (query.includes("FROM dm WHERE")) return result(input.dmRoots || []);
              if (query.includes("reply_to IN")) return result(input.messageReplies || []);
              return result(input.messageRoots || []);
            },
          };
        },
      };
    },
    async batch(statements: Array<{ all?: () => unknown }>) {
      void statements;
      return [result(input.messageReplies || [])];
    },
  };
  return { env: { DB } as never, calls };
}

test("unified reader selects roots before expanding only selected replies", async () => {
  const { env, calls } = createEnv({
    messageRoots: [
      { id: "m1", created_at: "2026-08-17T00:00:00.000Z", reply_to: null },
      { id: "m3", created_at: "2026-08-17T02:00:00.000Z", reply_to: null },
    ],
    dmRoots: [
      { id: "d2", created_at: "2026-08-17T01:00:00.000Z", uid: "visitor-a" },
    ],
    messageReplies: [
      { id: "m1-r", created_at: "2026-08-17T05:00:00.000Z", reply_to: "m1" },
    ],
    dmReplies: [
      {
        id: "d2-r",
        dm_id: "d2",
        owner_uid: "owner-a",
        text: "reply",
        image: null,
        channel_id: "channel-a",
        created_at: "2026-08-17T06:00:00.000Z",
      },
    ],
  });
  const page = await readUnifiedTimelinePage(env, "channel-a", { owner: true }, { limit: 3 });

  assert.equal(page.rootCount, 3);
  assert.deepEqual(page.items.map((item) => item.id), ["m1", "m1-r", "d2", "d2-r", "m3"]);
  assert.equal(page.pageStartCursor?.id, "m1");
  assert.equal(page.pageEndCursor?.id, "m3");
  assert.deepEqual(page.metrics, {
    queryCount: 4,
    rowsRead: 5,
    d1DurationMs: 0.5,
    rootCount: 3,
    itemCount: 5,
    maxChildrenPerRoot: 1,
    messageRootCount: 2,
    dmRootCount: 1,
    messageReplyCount: 1,
    dmReplyCount: 1,
  });
  assert.ok(calls.some((call) => call.query.includes("FROM dm_replies") && call.params.includes("d2")));
});

test("visitor DM candidate reads are scoped to the server-resolved identity", async () => {
  const { env, calls } = createEnv({});
  await readUnifiedTimelinePage(
    env,
    "channel-a",
    { owner: false, anonymousUid: "signed-visitor-a" },
  );
  const dmCall = calls.find((call) => call.query.includes("FROM dm WHERE"));
  assert.ok(dmCall);
  assert.match(dmCall.query, /channel_id = \?[\s\S]*uid = \?/);
  assert.deepEqual(dmCall.params.slice(0, 2), ["channel-a", "signed-visitor-a"]);
});

test("owner candidate reads do not add a visitor UID predicate", async () => {
  const { env, calls } = createEnv({});
  await readUnifiedTimelinePage(env, "channel-a", { owner: true });
  const dmCall = calls.find((call) => call.query.includes("FROM dm WHERE"));
  assert.ok(dmCall);
  assert.doesNotMatch(dmCall.query, /uid = \?/);
  assert.equal(dmCall.params[0], "channel-a");
});

test("source queries stay bounded before the in-memory merge", async () => {
  const { env, calls } = createEnv({});
  await readUnifiedTimelinePage(env, "channel-a", { owner: true }, { limit: 50 });
  const rootCalls = calls.filter((call) =>
    call.query.includes("FROM dm WHERE") || call.query.includes("FROM messages WHERE")
  );
  assert.equal(rootCalls.length, 2);
  for (const call of rootCalls) assert.equal(call.params.at(-1), 51);
});

test("root cursor predicates reduce source ordering to indexable time ranges", async () => {
  const { env, calls } = createEnv({});
  await readUnifiedTimelinePage(env, "channel-a", { owner: true }, {
    direction: "before",
    cursor: {
      visual_root_created_at: "2026-08-17T03:00:00.000Z",
      source: "dm",
      visual_root_id: "dm-cursor",
      visual_depth: 0,
      created_at: "2026-08-17T03:00:00.000Z",
      id: "dm-cursor",
    },
  });
  const messageCall = calls.find((call) => call.query.includes("FROM messages WHERE"));
  const dmCall = calls.find((call) => call.query.includes("FROM dm WHERE"));
  assert.ok(messageCall);
  assert.ok(dmCall);
  assert.match(messageCall.query, /created_at <= \?/);
  assert.doesNotMatch(messageCall.query, /id < \?/);
  assert.match(dmCall.query, /created_at < \?[\s\S]*id < \?/);
  assert.ok(dmCall.params.includes("dm-cursor"));
});

test("maximum pages split reply lookups below the D1 variable limit", async () => {
  const dmRoots = Array.from({ length: 100 }, (_, index) => ({
    id: `dm-${String(index).padStart(3, "0")}`,
    created_at: `2026-08-17T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    uid: "visitor-a",
  }));
  const { env, calls } = createEnv({ dmRoots });
  await readUnifiedTimelinePage(env, "channel-a", { owner: true }, { limit: 100 });
  const replyCalls = calls.filter((call) => call.query.includes("FROM dm_replies"));
  assert.equal(replyCalls.length, 2);
  for (const call of replyCalls) {
    assert.ok(call.params.length <= 51);
  }
});

test("centered windows resolve one target and keep candidate reads bounded", async () => {
  const { env, calls } = createEnv({
    messageRoots: [
      { id: "target", created_at: "2026-08-17T02:00:00.000Z", reply_to: null },
    ],
  });
  const page = await readUnifiedTimelineContextPage(
    env,
    "channel-a",
    { owner: true },
    "message",
    "target-reply",
  );

  assert.ok(page);
  assert.equal(page.targetId, "target-reply");
  const candidateCalls = calls.filter((call) =>
    call.query.includes("FROM messages WHERE")
    || call.query.includes("FROM dm WHERE")
  );
  assert.equal(candidateCalls.length, 4);
  for (const call of candidateCalls) assert.equal(call.params.at(-1), 26);
  assert.equal(calls.filter((call) => call.query.includes("WITH RECURSIVE ancestors")).length, 1);
});

test("centered DM target resolution applies the signed visitor UID", async () => {
  const { env, calls } = createEnv({
    dmRoots: [
      { id: "dm-root", created_at: "2026-08-17T02:00:00.000Z", uid: "visitor-a" },
    ],
  });
  await readUnifiedTimelineContextPage(
    env,
    "channel-a",
    { owner: false, anonymousUid: "visitor-a" },
    "dm",
    "dm-reply",
  );
  const targetCall = calls.find((call) => call.query.includes("SELECT d.* FROM dm d"));
  assert.ok(targetCall);
  assert.match(targetCall.query, /d\.uid = \?/);
  assert.equal(targetCall.params.at(-1), "visitor-a");
});
