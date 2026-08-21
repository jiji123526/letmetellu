import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildVisibleRootPageQuery,
  expandVisibleRootThreads,
  readVisibleMessagePage,
  readVisibleFlatThreads,
  VISIBLE_MESSAGE_CONDITION,
} from "../src/lib/visible-messages.ts";

const deletedRootMigration = readFileSync(
  new URL("../migrations/0054_deleted_message_root_pagination.sql", import.meta.url),
  "utf8",
);

test("deleted parent visibility uses an indexed child existence probe", () => {
  assert.match(VISIBLE_MESSAGE_CONDITION, /EXISTS/);
  assert.match(VISIBLE_MESSAGE_CONDITION, /child\.reply_to = messages\.id/);
  assert.doesNotMatch(VISIBLE_MESSAGE_CONDITION, /id IN/);
});

test("root pages bound deleted-parent probes to the active page window", () => {
  const before = buildVisibleRootPageQuery({
    channelId: "channel-a",
    cursorCondition: " AND (created_at, id) < (?, ?)",
    cursorParams: ["2026-08-09T00:10:00.000Z", "root-a"],
    direction: "before",
    limit: 51,
  });
  assert.match(before.query, /INDEXED BY messages_active_root_page_idx/);
  assert.match(before.query, /INDEXED BY messages_deleted_root_page_idx/);
  assert.match(before.query, /active_roots AS MATERIALIZED/);
  assert.match(before.query, /\(created_at, id\) >= \(\s*SELECT created_at, id FROM page_boundary/);
  assert.equal(
    before.query.match(/\(created_at, id\) < \(\?, \?\)/g)?.length,
    2,
  );
  assert.deepEqual(before.params, [
    "channel-a",
    "2026-08-09T00:10:00.000Z",
    "root-a",
    51,
    51,
    "",
    "",
    "channel-a",
    "2026-08-09T00:10:00.000Z",
    "root-a",
    "channel-a",
    51,
  ]);

  const after = buildVisibleRootPageQuery({
    channelId: "channel-a",
    direction: "after",
    limit: 51,
  });
  assert.match(after.query, /\(created_at, id\) <= \(\s*SELECT created_at, id FROM page_boundary/);
  assert.deepEqual(after.params.slice(3, 5), [
    "9999-12-31T23:59:59.999Z",
    "~",
  ]);
});

test("sparse page edges scan only deleted root index entries", () => {
  assert.match(
    deletedRootMigration,
    /CREATE INDEX IF NOT EXISTS messages_deleted_root_page_idx/,
  );
  assert.match(
    deletedRootMigration,
    /ON messages\(channel_id, created_at DESC, id DESC\)/,
  );
  assert.match(
    deletedRootMigration,
    /WHERE reply_to IS NULL AND deleted = 1/,
  );
});

test("flat thread expansion skips root lookups already present in the page", async () => {
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
        return [{ results: [] }];
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
  const [childCall] = calls;
  assert.doesNotMatch(childCall.query, /WITH requested_roots|UNION ALL/);
  assert.match(childCall.query, /channel_id = \?[\s\S]*reply_to IN \(\?, \?\)[\s\S]*deleted = 0/);
  assert.deepEqual(childCall.params, ["channel-a", "root-a", "root-d"]);
});

test("flat thread expansion fetches only missing roots but all children", async () => {
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
      { id: "reply-b", reply_to: "root-a", created_at: "2026-08-09T00:01:00.000Z" },
      { id: "root-d", reply_to: null, created_at: "2026-08-09T00:02:00.000Z" },
    ],
  );

  assert.equal(calls.length, 2);
  const [rootCall, childCall] = calls;
  assert.match(rootCall.query, /channel_id = \?[\s\S]*id IN \(\?\)/);
  assert.deepEqual(rootCall.params, ["channel-a", "root-a"]);
  assert.match(childCall.query, /channel_id = \?[\s\S]*reply_to IN \(\?, \?\)[\s\S]*deleted = 0/);
  assert.deepEqual(childCall.params, ["channel-a", "root-a", "root-d"]);
});

test("standalone thread reads fetch roots and children", async () => {
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

  await readVisibleFlatThreads(env as never, "channel-a", ["root-a", "root-d"]);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, ["channel-a", "root-a", "root-d"]);
  assert.deepEqual(calls[1].params, ["channel-a", "root-a", "root-d"]);
});

test("thread lookup sizes use bounded query-shape buckets", async () => {
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

  await readVisibleFlatThreads(
    env as never,
    "channel-a",
    ["root-a", "root-b", "root-c"],
  );

  assert.equal(calls.length, 2);
  assert.match(calls[0].query, /id IN \(\?, \?, \?, \?\)/);
  assert.match(calls[1].query, /reply_to IN \(\?, \?, \?, \?\)/);
  assert.deepEqual(calls[0].params, [
    "channel-a",
    "root-a",
    "root-b",
    "root-c",
    "root-c",
  ]);
  assert.deepEqual(calls[1].params, calls[0].params);
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
  const rootIds = Array.from({ length: 50 }, (_, index) => `root-${index}`);

  await readVisibleFlatThreads(env as never, "channel-a", rootIds);

  assert.deepEqual(boundParameterCounts, [51, 51]);
  assert.ok(boundParameterCounts.every((count) => count < 100));
});

test("context-sized root windows stay below the D1 variable limit", async () => {
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
  const rootIds = Array.from({ length: 51 }, (_, index) => `root-${index}`);

  await readVisibleFlatThreads(env as never, "channel-a", rootIds);

  assert.deepEqual(boundParameterCounts, [65, 65]);
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

test("message pages select root indexes and expand replies without moving cursors", async () => {
  const queries: string[] = [];
  const env = {
    DB: {
      prepare(query: string) {
        queries.push(query);
        return {
          bind() {
            return {
              async all() {
                return {
                  results: [
                    {
                      id: "page-a",
                      reply_to: null,
                      created_at: "2026-08-09T00:10:00.000Z",
                    },
                    {
                      id: "page-b",
                      reply_to: null,
                      created_at: "2026-08-09T00:11:00.000Z",
                    },
                  ],
                };
              },
            };
          },
        };
      },
      async batch() {
        return [
          {
            results: [{
              id: "reply-new",
              reply_to: "page-b",
              created_at: "2026-08-09T00:20:00.000Z",
            }],
          },
        ];
      },
    },
  };

  const page = await readVisibleMessagePage(env as never, "channel-a", { limit: 50 });

  assert.match(queries[0], /reply_to IS NULL/);
  assert.deepEqual(page.messages.map((message) => message.id), [
    "page-a",
    "page-b",
    "reply-new",
  ]);
  assert.deepEqual(page.pageStartCursor, {
    id: "page-a",
    createdAt: "2026-08-09T00:10:00.000Z",
  });
  assert.deepEqual(page.pageEndCursor, {
    id: "page-b",
    createdAt: "2026-08-09T00:11:00.000Z",
  });
});

test("message page cursors use composite timestamp and id ranges", async () => {
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

  await readVisibleMessagePage(env as never, "channel-a", {
    cursor: "2026-08-09T00:10:00.000Z",
    cursorId: "root-a",
    direction: "before",
  });
  await readVisibleMessagePage(env as never, "channel-a", {
    cursor: "2026-08-09T00:10:00.000Z",
    cursorId: "root-a",
    direction: "after",
  });

  assert.match(calls[0].query, /\(created_at, id\) < \(\?, \?\)/);
  assert.deepEqual(calls[0].params, [
    "channel-a",
    "2026-08-09T00:10:00.000Z",
    "root-a",
    51,
    51,
    "",
    "",
    "channel-a",
    "2026-08-09T00:10:00.000Z",
    "root-a",
    "channel-a",
    51,
  ]);
  assert.match(calls[1].query, /\(created_at, id\) > \(\?, \?\)/);
  assert.deepEqual(calls[1].params, [
    "channel-a",
    "2026-08-09T00:10:00.000Z",
    "root-a",
    51,
    51,
    "9999-12-31T23:59:59.999Z",
    "~",
    "channel-a",
    "2026-08-09T00:10:00.000Z",
    "root-a",
    "channel-a",
    51,
  ]);
});
