import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reactionBadgeSource = readFileSync(
  new URL("../../src/components/chat/ReactionBadge.tsx", import.meta.url),
  "utf8",
);

test("the current viewer's reaction uses a soft bubble-color tint", () => {
  assert.match(
    reactionBadgeSource,
    /background: data\.mine[\s\S]*color-mix\(in srgb, var\(--bubble-sent, #3598fe\) 16%, var\(--gray-bubble\)\)/,
  );
});
