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
