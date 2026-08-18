import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const initSource = readFileSync(
  new URL("../src/routes/init.ts", import.meta.url),
  "utf8",
);
const dataSource = readFileSync(
  new URL("../src/routes/data.ts", import.meta.url),
  "utf8",
);
const recentChannelsSource = readFileSync(
  new URL("../src/routes/recent-channels.ts", import.meta.url),
  "utf8",
);
const recentChannelsProxySource = readFileSync(
  new URL("../../src/app/api/recent-channels/route.ts", import.meta.url),
  "utf8",
);
const dmThreadsSource = readFileSync(
  new URL("../src/lib/dm-threads.ts", import.meta.url),
  "utf8",
);
const dmRouteSource = readFileSync(
  new URL("../src/routes/dm.ts", import.meta.url),
  "utf8",
);

test("init and data only resolve reports-owner access on reports channels", () => {
  assert.match(initSource, /const reportsChannel = isReportsChannel\(parentChannelId, env\)/);
  assert.match(initSource, /const isReportsOwnerViewer = reportsChannel && !isOwner/);
  assert.match(dataSource, /const reportsChannel = isReportsChannel\(parentChannelId, env\)/);
  assert.match(dataSource, /const isReportsOwnerViewer = reportsChannel && !isOwner/);
  assert.match(dataSource, /const reportsOwnerLocale = reportsChannel && isOwner && trustedUserId/);
});

test("recent-channel reads trust canonical proxy user ids instead of re-resolving users", () => {
  assert.match(recentChannelsProxySource, /"X-Canonical-User-Id": "1"/);
  assert.match(recentChannelsSource, /canonicalUserId: request\.headers\.get\("X-Canonical-User-Id"\) === "1"/);
  assert.match(recentChannelsSource, /if \(identity\.canonicalUserId && identity\.userId\) \{\s*return identity\.userId;/);
});

test("private dm thread roots select only the columns the client uses", () => {
  assert.match(dmThreadsSource, /const rootSelectColumns = "id, client_message_id, uid, auth_uid, nick, text, image, channel_id, created_at"/);
  assert.doesNotMatch(dmThreadsSource, /SELECT \* FROM \(SELECT \* FROM dm/);
});

test("dm reply limits probe for the twentieth row instead of counting the whole reply set", () => {
  assert.match(dmRouteSource, /WHERE NOT EXISTS \(\s*SELECT 1\s*FROM dm_replies\s*WHERE dm_id = \?\s*ORDER BY created_at ASC, id ASC\s*LIMIT 1 OFFSET \?/);
  assert.doesNotMatch(dmRouteSource, /SELECT COUNT\(\*\) FROM dm_replies WHERE dm_id = \?/);
});
