import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mutationSource = readFileSync(
  new URL("../../src/components/chat/useChatMessageMutations.ts", import.meta.url),
  "utf8",
);
const contextSource = readFileSync(
  new URL("../../src/components/chat/useChatContextMenuActions.ts", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src/lib/api-chat.ts", import.meta.url),
  "utf8",
);

test("owner deletion commits immediately and survives page refresh", () => {
  for (const source of [mutationSource, contextSource]) {
    assert.doesNotMatch(source, /pendingAdminDeleteRef/);
    assert.doesNotMatch(source, /actionLabel: text\.undo, onAction: undo/);
    assert.match(source, /adminAction\("delete-(?:message|dm)/);
    assert.match(source, /\{ keepalive: true \}/);
    assert.match(source, /restoreDeletedMessages/);
  }
  assert.match(apiSource, /options\?: \{ keepalive\?: boolean \}/);
  assert.match(apiSource, /keepalive: options\?\.keepalive/);
});
