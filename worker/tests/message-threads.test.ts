import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRequestedReplyId, resolveReplyRootId } from "../src/lib/message-threads.ts";

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
  assert.deepEqual(capturedParams, ["reply-c", "channel-a", "channel-a"]);
  assert.match(capturedQuery, /WHERE id = \? AND channel_id = \? AND deleted = 0/);
  assert.match(capturedQuery, /INNER JOIN ancestors ON ancestors\.reply_to = parent\.id/);
  assert.match(capturedQuery, /WHERE reply_to IS NULL/);
  assert.match(capturedQuery, /UNION\s+SELECT parent\.id/);
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
