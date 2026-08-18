import assert from "node:assert/strict";
import test from "node:test";
import { signProtectedMediaInPayload } from "../../src/lib/media-access-token.ts";
import { createAnonymousIdentity } from "../src/lib/anonymous-identity.ts";
import type { UnifiedTimelineCursor } from "../src/lib/unified-timeline.ts";
import { createRoomToken } from "../src/routes/passcode.ts";
import { handleUnifiedTimeline } from "../src/routes/unified-timeline.ts";
import type { Env } from "../src/types.ts";

const INTERNAL_SECRET = "unified-route-test-secret";
const CHANNEL_ID = "room-a";
const OWNER_ID = "owner-a";

interface RootRow {
  id: string;
  created_at: string;
  uid?: string;
  image?: string | null;
  reply_to?: null;
}

interface DmReplyRow {
  id: string;
  client_reply_id: string;
  dm_id: string;
  channel_id: string;
  owner_uid: string;
  text: string;
  image: string | null;
  created_at: string;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function selectRootWindow(
  rows: RootRow[],
  sql: string,
  params: unknown[],
  baseParamCount: number,
): RootRow[] {
  let filtered = [...rows];
  const cursorTime = String(params[baseParamCount] || "");
  if (sql.includes("created_at <= ?")) {
    filtered = filtered.filter((row) => row.created_at <= cursorTime);
  } else if (sql.includes("created_at < ?")) {
    filtered = filtered.filter((row) => row.created_at < cursorTime);
  } else if (sql.includes("created_at >= ?")) {
    filtered = filtered.filter((row) => row.created_at >= cursorTime);
  } else if (sql.includes("created_at > ?")) {
    filtered = filtered.filter((row) => row.created_at > cursorTime);
  }

  const limit = Number(params.at(-1));
  const ascending = (left: RootRow, right: RootRow) =>
    left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id);
  if (sql.includes("ORDER BY created_at DESC")) {
    return filtered.sort(ascending).reverse().slice(0, limit).sort(ascending);
  }
  return filtered.sort(ascending).slice(0, limit);
}

function createFixture(input: {
  channelExists?: boolean;
  channelId?: string;
  ownerId?: string;
  passcode?: string | null;
  reportsChannelId?: string;
  messageRoots?: RootRow[];
  dmRoots?: RootRow[];
  dmReplies?: DmReplyRow[];
}) {
  let channelExists = input.channelExists ?? true;
  let passcode = input.passcode ?? null;
  const channelId = input.channelId || CHANNEL_ID;
  const ownerId = input.ownerId || OWNER_ID;
  const messageRoots = input.messageRoots || [];
  const dmRoots = input.dmRoots || [];
  const dmReplies = input.dmReplies || [];
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  function statement(sqlText: string, params: unknown[] = []) {
    const sql = normalizeSql(sqlText);
    const bound = {
      bind(...nextParams: unknown[]) {
        return statement(sql, nextParams);
      },
      async first() {
        calls.push({ sql, params });
        if (sql.includes("SELECT passcode, owner_uid FROM channels")) {
          return channelExists ? { passcode, owner_uid: ownerId } : null;
        }
        if (sql.includes("SELECT owner_uid FROM channels")) {
          return channelExists ? { owner_uid: ownerId } : null;
        }
        if (sql.includes("SELECT locale FROM users")) {
          return { locale: "en" };
        }
        return null;
      },
      async all() {
        calls.push({ sql, params });
        if (sql.includes("FROM dm_replies")) {
          const selectedRootIds = new Set(params.slice(1).map(String));
          return {
            results: dmReplies.filter((reply) => selectedRootIds.has(reply.dm_id)),
          };
        }
        if (sql.includes("FROM dm WHERE")) {
          const visitorScoped = sql.includes("AND uid = ?");
          const visibleRoots = visitorScoped
            ? dmRoots.filter((row) => row.uid === params[1])
            : dmRoots;
          return {
            results: selectRootWindow(
              visibleRoots,
              sql,
              params,
              visitorScoped ? 2 : 1,
            ),
          };
        }
        if (sql.includes("reply_to IN")) return { results: [] };
        if (sql.includes("FROM messages WHERE")) {
          return { results: selectRootWindow(messageRoots, sql, params, 2) };
        }
        return { results: [] };
      },
      async run() {
        return { success: true, meta: { changes: 1 } };
      },
    };
    return bound;
  }

  const env = {
    INTERNAL_SECRET,
    REPORTS_CHANNEL_ID: input.reportsChannelId,
    DB: {
      prepare: statement,
      async batch(statements: Array<ReturnType<typeof statement>>) {
        return Promise.all(statements.map((item) => item.all()));
      },
    },
  } as unknown as Env;

  return {
    env,
    calls,
    deleteChannel() {
      channelExists = false;
    },
    setPasscode(nextPasscode: string | null) {
      passcode = nextPasscode;
    },
    channelId,
  };
}

function unifiedRequest(input: {
  channelId?: string;
  headers?: HeadersInit;
  params?: Record<string, string>;
} = {}): Request {
  const url = new URL("https://api.example.test/api/unified-timeline");
  url.searchParams.set("channel", input.channelId || CHANNEL_ID);
  for (const [key, value] of Object.entries(input.params || {})) {
    url.searchParams.set(key, value);
  }
  return new Request(url, { headers: input.headers });
}

function ownerHeaders(): HeadersInit {
  return {
    "X-Internal-Token": INTERNAL_SECRET,
    "X-User-Id": OWNER_ID,
  };
}

function cursorParams(
  cursor: UnifiedTimelineCursor,
  direction: "before" | "after",
): Record<string, string> {
  return {
    direction,
    cursor_visual_root_created_at: cursor.visual_root_created_at,
    cursor_source: cursor.source,
    cursor_visual_root_id: cursor.visual_root_id,
    cursor_visual_depth: String(cursor.visual_depth),
    cursor_created_at: cursor.created_at,
    cursor_id: cursor.id,
  };
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

test("unified route returns a versioned owner page containing every DM root", async () => {
  const fixture = createFixture({
    messageRoots: [{ id: "m1", created_at: "2026-08-18T00:00:00.000Z" }],
    dmRoots: [
      { id: "d1", created_at: "2026-08-18T01:00:00.000Z", uid: "visitor-a" },
      { id: "d2", created_at: "2026-08-18T02:00:00.000Z", uid: "visitor-b" },
    ],
  });
  const response = await handleUnifiedTimeline(unifiedRequest({ headers: ownerHeaders() }), fixture.env);
  const body = await readJson<{
    contract_version: number;
    items: Array<{ id: string; source: string }>;
    has_more: boolean;
    page_start_cursor: UnifiedTimelineCursor | null;
    page_end_cursor: UnifiedTimelineCursor | null;
  }>(response);

  assert.equal(response.status, 200);
  assert.equal(body.contract_version, 1);
  assert.deepEqual(body.items.map((item) => item.id), ["m1", "d1", "d2"]);
  assert.deepEqual(body.items.map((item) => item.source), ["message", "dm", "dm"]);
  assert.equal(body.has_more, false);
  assert.equal(body.page_start_cursor?.id, "m1");
  assert.equal(body.page_end_cursor?.id, "d2");
});

test("visitor route ignores URL UIDs and returns only signed-identity DMs", async () => {
  const fixture = createFixture({
    dmRoots: [
      { id: "d-a", created_at: "2026-08-18T00:00:00.000Z", uid: "visitor-a" },
      { id: "d-b", created_at: "2026-08-18T01:00:00.000Z", uid: "visitor-b" },
    ],
    dmReplies: [
      {
        id: "d-a-r",
        client_reply_id: "reply-a",
        dm_id: "d-a",
        channel_id: CHANNEL_ID,
        owner_uid: OWNER_ID,
        text: "private reply a",
        image: null,
        created_at: "2026-08-18T02:00:00.000Z",
      },
      {
        id: "d-b-r",
        client_reply_id: "reply-b",
        dm_id: "d-b",
        channel_id: CHANNEL_ID,
        owner_uid: OWNER_ID,
        text: "private reply b",
        image: null,
        created_at: "2026-08-18T03:00:00.000Z",
      },
    ],
  });
  const visitor = await createAnonymousIdentity(fixture.env, "visitor-b");
  const response = await handleUnifiedTimeline(unifiedRequest({
    headers: { "X-Anonymous-Token": visitor.token },
    params: { uid: "visitor-a" },
  }), fixture.env);
  const body = await readJson<{ items: Array<{ id: string }> }>(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body.items.map((item) => item.id), ["d-b", "d-b-r"]);
});

test("unsigned and forged visitors cannot read a unified page", async () => {
  const fixture = createFixture({});
  const unsigned = await handleUnifiedTimeline(unifiedRequest(), fixture.env);
  assert.equal(unsigned.status, 401);
  assert.equal(
    (await readJson<{ error: string }>(unsigned)).error,
    "anonymous_identity_required",
  );

  const identity = await createAnonymousIdentity(fixture.env, "visitor-a");
  const forged = await handleUnifiedTimeline(unifiedRequest({
    headers: { "X-Anonymous-Token": `${identity.token}tampered` },
  }), fixture.env);
  assert.equal(forged.status, 401);

  const forgedOwner = await handleUnifiedTimeline(unifiedRequest({
    headers: { "X-User-Id": OWNER_ID },
  }), fixture.env);
  assert.equal(forgedOwner.status, 401);
});

test("protected channels require a room token bound to the current passcode", async () => {
  const fixture = createFixture({ passcode: "current-passcode-hash" });
  const visitor = await createAnonymousIdentity(fixture.env, "visitor-a");
  const missing = await handleUnifiedTimeline(unifiedRequest({
    headers: { "X-Anonymous-Token": visitor.token },
  }), fixture.env);
  assert.equal(missing.status, 403);
  assert.equal((await readJson<{ error: string }>(missing)).error, "passcode required");

  const currentToken = await createRoomToken(
    CHANNEL_ID,
    "current-passcode-hash",
    fixture.env,
  );
  const allowed = await handleUnifiedTimeline(unifiedRequest({
    headers: {
      "X-Anonymous-Token": visitor.token,
      "X-Room-Token": currentToken,
    },
  }), fixture.env);
  assert.equal(allowed.status, 200);

  fixture.setPasscode("rotated-passcode-hash");
  const stale = await handleUnifiedTimeline(unifiedRequest({
    headers: {
      "X-Anonymous-Token": visitor.token,
      "X-Room-Token": currentToken,
    },
  }), fixture.env);
  assert.equal(stale.status, 403);
  assert.equal((await readJson<{ error: string }>(stale)).error, "invalid token");
});

test("deleted, live and reports channels retain explicit route boundaries", async () => {
  const deletedFixture = createFixture({});
  deletedFixture.deleteChannel();
  const deleted = await handleUnifiedTimeline(
    unifiedRequest({ headers: ownerHeaders() }),
    deletedFixture.env,
  );
  assert.equal(deleted.status, 404);

  const liveFixture = createFixture({ channelId: CHANNEL_ID });
  const live = await handleUnifiedTimeline(unifiedRequest({
    channelId: `${CHANNEL_ID}_live`,
    headers: ownerHeaders(),
  }), liveFixture.env);
  assert.equal(live.status, 409);
  assert.equal(
    (await readJson<{ error: string }>(live)).error,
    "unified_timeline_unsupported",
  );

  const reportsFixture = createFixture({
    channelId: "reports",
    reportsChannelId: "reports",
  });
  const reports = await handleUnifiedTimeline(unifiedRequest({
    channelId: "reports",
    headers: ownerHeaders(),
  }), reportsFixture.env);
  assert.equal(reports.status, 409);

  const visitor = await createAnonymousIdentity(reportsFixture.env, "visitor-a");
  const unauthorizedReports = await handleUnifiedTimeline(unifiedRequest({
    channelId: "reports",
    headers: { "X-Anonymous-Token": visitor.token },
  }), reportsFixture.env);
  assert.equal(unauthorizedReports.status, 403);
});

test("malformed, partial and non-root cursors return 400", async () => {
  const fixture = createFixture({});
  const partial = await handleUnifiedTimeline(unifiedRequest({
    headers: ownerHeaders(),
    params: { cursor_visual_root_id: "m1", direction: "before" },
  }), fixture.env);
  assert.equal(partial.status, 400);
  assert.equal(
    (await readJson<{ error: string }>(partial)).error,
    "invalid_unified_cursor",
  );

  const replyCursor = {
    visual_root_created_at: "2026-08-18T00:00:00.000Z",
    source: "message" as const,
    visual_root_id: "m1",
    visual_depth: 1 as const,
    created_at: "2026-08-18T01:00:00.000Z",
    id: "m1-r",
  };
  const nonRoot = await handleUnifiedTimeline(unifiedRequest({
    headers: ownerHeaders(),
    params: cursorParams(replyCursor, "before"),
  }), fixture.env);
  assert.equal(nonRoot.status, 400);

  const rootCursor = {
    ...replyCursor,
    visual_depth: 0 as const,
    created_at: replyCursor.visual_root_created_at,
    id: replyCursor.visual_root_id,
  };
  const missingDirection = await handleUnifiedTimeline(unifiedRequest({
    headers: ownerHeaders(),
    params: {
      ...cursorParams(rootCursor, "before"),
      direction: "",
    },
  }), fixture.env);
  assert.equal(missingDirection.status, 400);
});

test("centered navigation rejects invalid sources and missing targets", async () => {
  const fixture = createFixture({});
  const invalidSource = await handleUnifiedTimeline(unifiedRequest({
    headers: ownerHeaders(),
    params: { target_id: "m1", target_source: "report" },
  }), fixture.env);
  assert.equal(invalidSource.status, 400);

  const missingTarget = await handleUnifiedTimeline(unifiedRequest({
    headers: ownerHeaders(),
    params: { target_id: "missing", target_source: "message" },
  }), fixture.env);
  assert.equal(missingTarget.status, 404);
});

test("latest, before and after root pages join without duplicates or gaps", async () => {
  const fixture = createFixture({
    messageRoots: [
      { id: "m1", created_at: "2026-08-18T00:00:00.000Z" },
      { id: "m3", created_at: "2026-08-18T02:00:00.000Z" },
      { id: "m5", created_at: "2026-08-18T04:00:00.000Z" },
    ],
    dmRoots: [
      { id: "d2", created_at: "2026-08-18T01:00:00.000Z", uid: "visitor-a" },
      { id: "d4", created_at: "2026-08-18T03:00:00.000Z", uid: "visitor-a" },
    ],
  });
  const latestResponse = await handleUnifiedTimeline(unifiedRequest({
    headers: ownerHeaders(),
    params: { limit: "2" },
  }), fixture.env);
  const latest = await readJson<{
    items: Array<{ id: string; visual_depth: number }>;
    page_start_cursor: UnifiedTimelineCursor;
  }>(latestResponse);
  assert.deepEqual(latest.items.map((item) => item.id), ["d4", "m5"]);

  const middleResponse = await handleUnifiedTimeline(unifiedRequest({
    headers: ownerHeaders(),
    params: {
      limit: "2",
      ...cursorParams(latest.page_start_cursor, "before"),
    },
  }), fixture.env);
  const middle = await readJson<{
    items: Array<{ id: string }>;
    page_start_cursor: UnifiedTimelineCursor;
    page_end_cursor: UnifiedTimelineCursor;
  }>(middleResponse);
  assert.deepEqual(middle.items.map((item) => item.id), ["d2", "m3"]);

  const oldestResponse = await handleUnifiedTimeline(unifiedRequest({
    headers: ownerHeaders(),
    params: {
      limit: "2",
      ...cursorParams(middle.page_start_cursor, "before"),
    },
  }), fixture.env);
  const oldest = await readJson<{ items: Array<{ id: string }> }>(oldestResponse);
  assert.deepEqual(oldest.items.map((item) => item.id), ["m1"]);

  const newerResponse = await handleUnifiedTimeline(unifiedRequest({
    headers: ownerHeaders(),
    params: {
      limit: "2",
      ...cursorParams(middle.page_end_cursor, "after"),
    },
  }), fixture.env);
  const newer = await readJson<{ items: Array<{ id: string }> }>(newerResponse);
  assert.deepEqual(newer.items.map((item) => item.id), ["d4", "m5"]);

  const joined = [...oldest.items, ...middle.items, ...latest.items].map((item) => item.id);
  assert.deepEqual(joined, ["m1", "d2", "m3", "d4", "m5"]);
  assert.equal(new Set(joined).size, joined.length);
});

test("route clamps page roots to 100", async () => {
  const fixture = createFixture({
    messageRoots: Array.from({ length: 110 }, (_, index) => ({
      id: `m-${String(index).padStart(3, "0")}`,
      created_at: `2026-08-18T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    })),
  });
  const response = await handleUnifiedTimeline(unifiedRequest({
    headers: ownerHeaders(),
    params: { limit: "1000" },
  }), fixture.env);
  const body = await readJson<{ items: unknown[]; has_more: boolean }>(response);
  assert.equal(response.status, 200);
  assert.equal(body.items.length, 100);
  assert.equal(body.has_more, true);
});

test("protected media signing includes unified items", async () => {
  process.env.INTERNAL_SECRET = INTERNAL_SECRET;
  const payload = await signProtectedMediaInPayload({
    contract_version: 1,
    items: [
      { id: "m1", image: `/api/media/${CHANNEL_ID}/message.jpg` },
      { id: "m2", image: null },
    ],
  }, { userId: OWNER_ID });

  assert.match(payload.items[0].image || "", /media_token=/);
  assert.equal(payload.items[1].image, null);
});

test("protected media signing includes unified init items", async () => {
  process.env.INTERNAL_SECRET = INTERNAL_SECRET;
  const payload = await signProtectedMediaInPayload({
    unifiedTimeline: {
      contract_version: 1,
      items: [
        { id: "m1", image: `/api/media/${CHANNEL_ID}/bootstrap.jpg` },
      ],
    },
  }, { userId: OWNER_ID });

  assert.match(payload.unifiedTimeline.items[0].image || "", /media_token=/);
});
