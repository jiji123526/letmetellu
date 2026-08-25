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
const realtimeSyncSource = readFileSync(
  new URL("../../src/components/chat/useChatRealtimeSync.ts", import.meta.url),
  "utf8",
);
const chatRoomSource = readFileSync(
  new URL("../src/realtime/chat-room.ts", import.meta.url),
  "utf8",
);

test("portaled live emoji controls anchor to the composer trigger", () => {
  assert.match(emojiBarSource, /createPortal/);
  assert.match(
    emojiBarSource,
    /setAnchorRect\(event\.currentTarget\.getBoundingClientRect\(\)\)/,
  );
  assert.match(
    emojiBarSource,
    /const anchoredRight = Math\.max\(12, window\.innerWidth - anchorRect\.right\)/,
  );
  assert.match(
    emojiBarSource,
    /className="emoji-fx-grid"[\s\S]*position: "fixed"[\s\S]*bottom: `\$\{anchoredBottom\}px`[\s\S]*right: `\$\{anchoredRight\}px`/,
  );
  assert.match(
    emojiBarSource,
    /className="emoji-fx-picker-wrap"[\s\S]*position: "fixed"[\s\S]*right: `\$\{anchoredRight\}px`/,
  );
  assert.match(
    bottomShellSource,
    /className="flex-1 flex items-end relative"/,
  );
});

test("emoji selection still spawns locally before realtime broadcast", () => {
  assert.match(
    emojiBarSource,
    /const triggerEmoji = \(emoji: string\) => \{[\s\S]*spawnEmoji\(emoji, x, h\);[\s\S]*onBroadcast\(emoji, x, h\)/,
  );
});

test("emoji broadcasts are restricted to active live viewers", () => {
  assert.match(
    realtimeSyncSource,
    /event\.type === "emoji-fx" && inLiveModeRef\.current/,
  );
  assert.match(
    chatRoomSource,
    /data\.type === "emoji-fx" && connection\.authorized && connection\.inLive/,
  );
  assert.match(
    chatRoomSource,
    /broadcastToLive\(message: string\)[\s\S]*!connection\.authorized \|\| !connection\.inLive/,
  );
  assert.doesNotMatch(
    chatRoomSource,
    /\(data\.type === "emoji-fx" \|\| data\.type === "typing"\)/,
  );
});
