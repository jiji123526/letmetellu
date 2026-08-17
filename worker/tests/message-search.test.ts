import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_MESSAGE_SEARCH_QUERY_LENGTH,
  normalizeMessageSearchQuery,
  shouldUseTrigramMessageSearch,
  toFts5Phrase,
} from "../src/lib/message-search.ts";
import {
  addSearchVisualOrder,
  sortSearchMessagesByVisualOrder,
} from "../../src/components/chat/search-order.ts";

const dataSource = readFileSync(new URL("../src/routes/data.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../migrations/0044_trigram_message_search.sql", import.meta.url),
  "utf8",
);

test("message search preserves literal substring queries", () => {
  assert.equal(normalizeMessageSearchQuery("  콩  "), "콩");
  assert.equal(normalizeMessageSearchQuery("워터  재밌"), "워터  재밌");
  assert.equal(normalizeMessageSearchQuery("say \"hi\""), "say \"hi\"");
});

test("message search uses trigram indexing only when the query has three code points", () => {
  assert.equal(shouldUseTrigramMessageSearch("가나"), false);
  assert.equal(shouldUseTrigramMessageSearch("가나다"), true);
  assert.equal(shouldUseTrigramMessageSearch("ab"), false);
  assert.equal(shouldUseTrigramMessageSearch("abc"), true);
  assert.equal(shouldUseTrigramMessageSearch("👍👍"), false);
  assert.equal(shouldUseTrigramMessageSearch("👍👍👍"), true);
});

test("message search quotes literal FTS5 phrases", () => {
  assert.equal(toFts5Phrase("워터  재밌"), '"워터  재밌"');
  assert.equal(toFts5Phrase('say "hi"'), '"say ""hi"""');
  assert.equal(toFts5Phrase("a OR b"), '"a OR b"');
});

test("message search routes long queries through trigram FTS and preserves the short fallback", () => {
  assert.match(dataSource, /FROM messages_fts/);
  assert.match(dataSource, /WHERE messages_fts MATCH \?/);
  assert.match(dataSource, /instr\(lower\(COALESCE\(m\.text, ''\)\), lower\(\?\)\) > 0/);
});

test("message search follows rendered root and reply order instead of reply creation time", () => {
  const messages = addSearchVisualOrder([
    {
      id: "root-old",
      text: "no match",
      created_at: "2026-08-17T10:00:00.000Z",
      reply_to: null,
    },
    {
      id: "reply-old-1",
      text: "match",
      created_at: "2026-08-17T10:30:00.000Z",
      reply_to: "root-old",
    },
    {
      id: "root-new",
      text: "match",
      created_at: "2026-08-17T11:00:00.000Z",
      reply_to: null,
    },
    {
      id: "reply-old-2",
      text: "match",
      created_at: "2026-08-17T12:00:00.000Z",
      reply_to: "root-old",
    },
  ]);
  const matches = sortSearchMessagesByVisualOrder(
    messages.filter((message) => message.text === "match"),
  );

  assert.deepEqual(
    matches.map((message) => message.id),
    ["reply-old-1", "reply-old-2", "root-new"],
  );
  assert.equal(matches.at(-1)?.id, "root-new");
});

test("message search SQL and cursor use the complete visual thread position", () => {
  assert.match(dataSource, /LEFT JOIN messages root/);
  assert.match(dataSource, /COALESCE\(root\.created_at, m\.created_at\) AS visual_root_created_at/);
  assert.match(dataSource, /COALESCE\(root\.id, m\.id\) AS visual_root_id/);
  assert.match(dataSource, /visual_root_created_at DESC,[\s\S]*visual_depth DESC,[\s\S]*created_at DESC/);
  assert.match(dataSource, /visual_root_created_at < \?/);
  assert.match(dataSource, /visual_depth < \?/);
});

test("trigram migration rebuilds existing content and limits updates to text changes", () => {
  assert.match(migrationSource, /tokenize='trigram'/);
  assert.match(migrationSource, /AFTER UPDATE OF text ON messages/);
  assert.match(migrationSource, /VALUES\('rebuild'\)/);
});

test("message search rejects whitespace-only input and caps query length", () => {
  assert.equal(normalizeMessageSearchQuery("   "), "");
  assert.equal(
    normalizeMessageSearchQuery("x".repeat(MAX_MESSAGE_SEARCH_QUERY_LENGTH + 1)).length,
    MAX_MESSAGE_SEARCH_QUERY_LENGTH,
  );
});
