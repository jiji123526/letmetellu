import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const initialSchema = readFileSync(
  new URL("../migrations/0001_initial_schema.sql", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../migrations/0043_message_reply_foreign_key_lookup.sql", import.meta.url),
  "utf8",
);
const audit = readFileSync(
  new URL("../scripts/audit-message-delete-index.sql", import.meta.url),
  "utf8",
);

test("message deletion has a reply-leading foreign-key lookup index", () => {
  assert.match(
    initialSchema,
    /FOREIGN KEY \(reply_to\) REFERENCES messages\(id\) ON DELETE SET NULL/,
  );
  assert.match(
    migration,
    /messages_reply_to_idx\s+ON messages\(reply_to\)/,
  );
});

test("production audit verifies the exact foreign-key child lookup", () => {
  assert.match(audit, /PRAGMA index_info\('messages_reply_to_idx'\)/);
  assert.match(
    audit,
    /EXPLAIN QUERY PLAN[\s\S]*FROM messages[\s\S]*WHERE reply_to = '__message_delete_audit__'/,
  );
  assert.match(audit, /PRAGMA foreign_key_check/);
});
