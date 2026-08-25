import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const emojiBarSource = readFileSync(
  new URL("../../src/components/chat/EmojiBar.tsx", import.meta.url),
  "utf8",
);
const bottomShellSource = readFileSync(
  new URL("../../src/components/chat/ChatViewBottomShell.tsx", import.meta.url),
  "utf8",
);

test("live emoji controls anchor to the chat composer", () => {
  assert.doesNotMatch(emojiBarSource, /createPortal/);
  assert.match(
    emojiBarSource,
    /className="emoji-fx-grid"[\s\S]*position: "absolute"[\s\S]*bottom: "calc\(100% \+ 8px\)"[\s\S]*right: "0"/,
  );
  assert.match(
    emojiBarSource,
    /className="emoji-fx-picker-wrap"[\s\S]*position: "absolute"[\s\S]*right: "0"/,
  );
  assert.match(
    bottomShellSource,
    /className="flex-1 flex items-end relative"/,
  );
});
