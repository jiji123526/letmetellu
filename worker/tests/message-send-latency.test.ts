import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { syncMessageLink, syncNewMessageLink } from "../src/lib/message-links.ts";

function createLinkDbRecorder() {
  const statements: string[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind() {
            return { run: async () => ({ success: true }) };
          },
        };
      },
    },
  };
  return { env, statements };
}

test("new messages without links skip the impossible cleanup write", async () => {
  const { env, statements } = createLinkDbRecorder();
  await syncNewMessageLink(env as never, "message-1", "channel-1", "2026-08-16T00:00:00.000Z", "hello");
  assert.deepEqual(statements, []);
});

test("new linked messages are indexed and edits can still remove stale links", async () => {
  const created = createLinkDbRecorder();
  await syncNewMessageLink(
    created.env as never,
    "message-1",
    "channel-1",
    "2026-08-16T00:00:00.000Z",
    "https://example.com",
  );
  assert.equal(created.statements.length, 1);
  assert.match(created.statements[0], /INSERT INTO message_links/);

  const edited = createLinkDbRecorder();
  await syncMessageLink(
    edited.env as never,
    "message-1",
    "channel-1",
    "2026-08-16T00:00:00.000Z",
    "link removed",
  );
  assert.equal(edited.statements.length, 1);
  assert.match(edited.statements[0], /DELETE FROM message_links/);
});

test("anonymous and device identity verification run through one parallel barrier", () => {
  const source = readFileSync(new URL("../src/routes/messages.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /await Promise\.all\(\[\s*getAnonymousRequesterUid\(request, env\),\s*getRequesterDeviceId\(request, env\),\s*\]\)/,
  );
});
