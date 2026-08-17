import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isValidClientMessageId } from "../src/lib/message-idempotency.ts";

test("client message ids accept UUID submissions and photo suffixes", () => {
  assert.equal(isValidClientMessageId("4f57a177-c67f-4af6-9b3a-4a1885f04973"), true);
  assert.equal(isValidClientMessageId("4f57a177-c67f-4af6-9b3a-4a1885f04973:12"), true);
});

test("client message ids reject missing, malformed and oversized values", () => {
  assert.equal(isValidClientMessageId(undefined), false);
  assert.equal(isValidClientMessageId("short"), false);
  assert.equal(isValidClientMessageId("valid-id<script>"), false);
  assert.equal(isValidClientMessageId("a".repeat(129)), false);
});

test("message idempotency migration covers chat and DM writes", () => {
  const migration = readFileSync(new URL("../migrations/0033_message_send_idempotency.sql", import.meta.url), "utf8");
  assert.match(migration, /ALTER TABLE messages ADD COLUMN client_message_id TEXT/);
  assert.match(migration, /ALTER TABLE dm ADD COLUMN client_message_id TEXT/);
  assert.match(migration, /UNIQUE INDEX[\s\S]*messages\(client_message_id\)/);
  assert.match(migration, /UNIQUE INDEX[\s\S]*dm\(client_message_id\)/);
});

test("duplicate message retries rebroadcast the persisted message", () => {
  const route = readFileSync(new URL("../src/routes/messages.ts", import.meta.url), "utf8");
  assert.match(route, /routeStage = "rebroadcast_duplicate"[\s\S]*broadcastPersistedMessage/);
  assert.match(route, /routeStage = "rebroadcast_batch_duplicate"[\s\S]*broadcastPersistedMessage/);
  assert.match(route, /stage: "broadcast_message"[\s\S]*broadcastPersistedMessage/);
  assert.match(route, /ctx\.waitUntil\(postCommitDelivery\)/);
  assert.match(route, /message_broadcast_failed/);
  assert.match(route, /duplicate: true,[\s\S]*message: existingMessage/);
  assert.match(route, /duplicate: true,[\s\S]*message: duplicate/);
  assert.match(route, /Response\.json\(\{ id, created_at, message: newMessage \}\)/);
});
