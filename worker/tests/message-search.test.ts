import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_MESSAGE_SEARCH_QUERY_LENGTH,
  normalizeMessageSearchQuery,
} from "../src/lib/message-search.ts";

test("message search preserves literal substring queries", () => {
  assert.equal(normalizeMessageSearchQuery("  콩  "), "콩");
  assert.equal(normalizeMessageSearchQuery("워터  재밌"), "워터  재밌");
  assert.equal(normalizeMessageSearchQuery("say \"hi\""), "say \"hi\"");
});

test("message search rejects whitespace-only input and caps query length", () => {
  assert.equal(normalizeMessageSearchQuery("   "), "");
  assert.equal(
    normalizeMessageSearchQuery("x".repeat(MAX_MESSAGE_SEARCH_QUERY_LENGTH + 1)).length,
    MAX_MESSAGE_SEARCH_QUERY_LENGTH,
  );
});
