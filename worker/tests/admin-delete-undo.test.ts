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
const toastSource = readFileSync(
  new URL("../../src/components/chat/ChatViewBottomShell.tsx", import.meta.url),
  "utf8",
);

test("owner deletion waits five seconds and exposes an undo action", () => {
  for (const source of [mutationSource, contextSource]) {
    assert.match(source, /setTimeout\(\(\) => \{[\s\S]*commit\(\);[\s\S]*\}, 5000\)/);
    assert.match(source, /actionLabel: text\.undo, onAction: undo/);
    assert.match(source, /clearTimeout\(pending\.timer\)/);
  }
  assert.match(toastSource, /banner\.actionLabel && banner\.onAction/);
  assert.match(toastSource, /onClick=\{banner\.onAction\}/);
});
