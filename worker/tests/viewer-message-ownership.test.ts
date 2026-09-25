import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { markViewerOwnedMessages } from "../src/lib/viewer-message-ownership.ts";

function createEnv() {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const env = {
    DB: {
      prepare(query: string) {
        return {
          bind(...params: unknown[]) {
            calls.push({ query, params });
            return {
              async all() {
                return {
                  results: params[1] === "account-a"
                    ? [{ message_id: "message-a" }]
                    : [],
                };
              },
            };
          },
        };
      },
    },
  };
  return { env: env as never, calls };
}

test("loaded messages are marked owned through the private account mapping", async () => {
  const { env, calls } = createEnv();
  const messages = await markViewerOwnedMessages(
    env,
    "channel-a",
    "account-a",
    [
      { id: "message-a" },
      { id: "message-b" },
      { id: "dm-a", source: "dm", dm: true },
    ],
  );

  assert.equal(messages[0].viewer_owned, true);
  assert.equal(messages[1].viewer_owned, undefined);
  assert.equal(messages[2].viewer_owned, undefined);
  assert.deepEqual(calls[0].params, [
    "channel-a",
    "account-a",
    "message-a",
    "message-b",
  ]);
});

test("guest reads do not perform account ownership lookups", async () => {
  const { env, calls } = createEnv();
  const messages = [{ id: "message-a" }];
  assert.equal(
    await markViewerOwnedMessages(env, "channel-a", null, messages),
    messages,
  );
  assert.deepEqual(calls, []);
});

test("message edit and delete authorize the private account mapping", () => {
  const source = readFileSync(
    new URL("../src/routes/messages.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /X-Notification-Actor-User-Id[\s\S]*FROM message_notification_owners account_owner[\s\S]*account_owned/,
  );
  assert.match(
    source,
    /msg\.uid !== requesterUid && !msg\.account_owned/,
  );
});
