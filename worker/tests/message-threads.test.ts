import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeRequestedReplyId, resolveReplyRootId } from "../src/lib/message-threads.ts";

const migrationSource = readFileSync(
  new URL("../migrations/0049_message_canonical_root.sql", import.meta.url),
  "utf8",
);
const messagesRouteSource = readFileSync(
  new URL("../src/routes/messages.ts", import.meta.url),
  "utf8",
);
const moderationSource = readFileSync(
  new URL("../src/lib/channel-moderation.ts", import.meta.url),
  "utf8",
);

test("reply ids are normalized and bounded before lookup", () => {
  assert.equal(normalizeRequestedReplyId(undefined), null);
  assert.equal(normalizeRequestedReplyId(null), null);
  assert.equal(normalizeRequestedReplyId(""), null);
  assert.equal(normalizeRequestedReplyId("  message-a  "), "message-a");
  assert.equal(normalizeRequestedReplyId(123), undefined);
  assert.equal(normalizeRequestedReplyId("x".repeat(129)), undefined);
});

test("reply root lookup stays in-channel and requires a visible target", async () => {
  let capturedQuery = "";
  let capturedParams: unknown[] = [];
  const env = {
    DB: {
      prepare(query: string) {
        capturedQuery = query;
        return {
          bind(...params: unknown[]) {
            capturedParams = params;
            return {
              async first() {
                return { id: "root-a" };
              },
            };
          },
        };
      },
    },
  };

  const rootId = await resolveReplyRootId(env as never, "channel-a", "reply-c");

  assert.equal(rootId, "root-a");
  assert.deepEqual(capturedParams, ["reply-c", "channel-a"]);
  assert.match(capturedQuery, /SELECT root_id AS id/);
  assert.match(capturedQuery, /WHERE id = \? AND channel_id = \? AND deleted = 0/);
  assert.match(capturedQuery, /root_id IS NOT NULL/);
  assert.doesNotMatch(capturedQuery, /WITH RECURSIVE/);
});

test("reply root lookup rejects missing, broken or cyclic chains", async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return { async first() { return null; } };
          },
        };
      },
    },
  };

  assert.equal(await resolveReplyRootId(env as never, "channel-a", "missing"), null);
});

test("canonical roots are backfilled once and persisted by every message writer", () => {
  assert.match(migrationSource, /ALTER TABLE messages ADD COLUMN root_id TEXT/);
  assert.match(migrationSource, /WITH RECURSIVE message_roots\(id, root_id\)/);
  assert.match(migrationSource, /WHERE reply_to IS NULL/);
  assert.match(migrationSource, /INNER JOIN message_roots ON child\.reply_to = message_roots\.id/);
  assert.doesNotMatch(migrationSource, /CREATE INDEX/);

  assert.match(messagesRouteSource, /reply_to, root_id, report/);
  assert.match(messagesRouteSource, /resolvedReplyTo, resolvedReplyTo \|\| id, report/);
  assert.match(moderationSource, /reply_to, root_id, report/);
});
