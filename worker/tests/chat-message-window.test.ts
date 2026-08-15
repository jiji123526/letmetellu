import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_MOUNTED_HISTORY_MESSAGES,
  mergeServerMessageSnapshot,
  upsertAcknowledgedMessages,
  trimMessageWindow,
} from "../../src/components/chat/chatMessageUtils.ts";

interface TestMessage {
  id: string;
  uid: string;
  nick: string | null;
  text: string;
  is_admin: number;
  image: string | null;
  reactions: string;
  reply_to: string | null;
  created_at: string;
}

function message(id: string, createdAt: string, replyTo: string | null = null): TestMessage {
  return {
    id,
    uid: "user-a",
    nick: null,
    text: id,
    is_admin: 0,
    image: null,
    reactions: "{}",
    reply_to: replyTo,
    created_at: createdAt,
  };
}

test("history trimming follows root order instead of late reply timestamps", () => {
  const roots = Array.from({ length: MAX_MOUNTED_HISTORY_MESSAGES }, (_, index) =>
    message(`root-${index}`, `2026-08-13T00:${String(index).padStart(3, "0")}:00.000Z`)
  );
  const lateReply = message(
    "reply-to-first",
    "2026-08-14T00:00:00.000Z",
    roots[0].id,
  );
  const newestRoot = message("root-newest", "2026-08-15T00:00:00.000Z");
  const trimmed = trimMessageWindow([...roots, lateReply, newestRoot], "newer");
  const ids = new Set(trimmed.map((entry) => entry.id));

  assert.equal(ids.has(roots[0].id), false);
  assert.equal(ids.has(lateReply.id), false);
  assert.equal(ids.has(roots[1].id), true);
  assert.equal(ids.has(newestRoot.id), true);
});

test("acknowledged messages append or replace by id without rebuilding the snapshot", () => {
  const first = message("first", "2026-08-15T00:00:00.000Z");
  const existing = message("existing", "2026-08-15T00:01:00.000Z");
  const acknowledgedExisting = { ...existing, client_message_id: "send-1" };
  const acknowledgedNew = {
    ...message("new", "2026-08-15T00:02:00.000Z"),
    client_message_id: "send-2",
  };

  const result = upsertAcknowledgedMessages(
    [first, existing],
    [acknowledgedExisting, acknowledgedNew],
  );

  assert.deepEqual(result.map((entry) => entry.id), ["first", "existing", "new"]);
  assert.equal(result[0], first);
  assert.equal(result[1], acknowledgedExisting);
  assert.equal(result[2], acknowledgedNew);
  assert.equal(upsertAcknowledgedMessages(result, [acknowledgedExisting]), result);
});

test("latest snapshots replace mounted threads without removing unrelated old replies", () => {
  const oldRoot = message("old-root", "2026-08-01T00:00:00.000Z");
  const oldReply = message("old-reply", "2026-08-13T00:00:00.000Z", oldRoot.id);
  const latestRoot = message("latest-root", "2026-08-12T00:00:00.000Z");
  const staleLatestReply = message(
    "stale-latest-reply",
    "2026-08-12T00:01:00.000Z",
    latestRoot.id,
  );
  const refreshedLatestRoot = { ...latestRoot, text: "updated" };

  const merged = mergeServerMessageSnapshot(
    [oldRoot, latestRoot, staleLatestReply, oldReply],
    [refreshedLatestRoot],
  );
  const ids = new Set(merged.map((entry) => entry.id));

  assert.equal(ids.has(oldRoot.id), true);
  assert.equal(ids.has(oldReply.id), true);
  assert.equal(ids.has(staleLatestReply.id), false);
  assert.equal(merged.find((entry) => entry.id === latestRoot.id)?.text, "updated");
});
