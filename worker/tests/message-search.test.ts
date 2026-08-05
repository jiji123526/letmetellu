import assert from "node:assert/strict";
import test from "node:test";

import { buildMessageSearchQuery } from "../src/lib/message-search.ts";

test("message search builds safe prefix terms", () => {
  assert.equal(buildMessageSearchQuery("콩"), "\"콩\"*");
  assert.equal(
    buildMessageSearchQuery("  워터  재밌  "),
    "\"워터\"* AND \"재밌\"*",
  );
});

test("message search escapes quotes and rejects whitespace-only input", () => {
  assert.equal(buildMessageSearchQuery("say \"hi\""), "\"say\"* AND \"\"\"hi\"\"\"*");
  assert.equal(buildMessageSearchQuery("   "), "");
});
