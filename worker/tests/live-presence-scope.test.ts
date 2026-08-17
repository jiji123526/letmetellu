import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const initSource = readFileSync(
  new URL("../src/routes/init.ts", import.meta.url),
  "utf8",
);
const chatRoomSource = readFileSync(
  new URL("../src/realtime/chat-room.ts", import.meta.url),
  "utf8",
);
const realtimeHookSource = readFileSync(
  new URL("../../src/hooks/useRealtime.ts", import.meta.url),
  "utf8",
);

test("chat bootstrap does not query Durable Object presence", () => {
  assert.doesNotMatch(initSource, /readInitPresenceCount/);
  assert.doesNotMatch(initSource, /presence:\s*presenceCount/);
  assert.doesNotMatch(initSource, /CHAT_ROOM/);
});

test("Durable Object presence tracks only active live viewers", () => {
  assert.doesNotMatch(chatRoomSource, /url\.pathname\.endsWith\("\/presence"\)/);
  assert.doesNotMatch(chatRoomSource, /lastPresenceCount/);
  assert.doesNotMatch(chatRoomSource, /type:\s*"presence"/);
  assert.match(chatRoomSource, /connection\.authorized && connection\.inLive/);
  assert.match(chatRoomSource, /type:\s*"live-presence"/);
  assert.match(chatRoomSource, /!connection\.authorized \|\| !connection\.inLive/);
  assert.match(chatRoomSource, /queueLivePresenceBroadcast\(\)/);
});

test("realtime client keeps only the live viewer count", () => {
  assert.doesNotMatch(realtimeHookSource, /\[presence,\s*setPresence\]/);
  assert.doesNotMatch(realtimeHookSource, /\bsetPresence\b/);
  assert.doesNotMatch(realtimeHookSource, /data\.type === "presence"/);
  assert.match(realtimeHookSource, /data\.type === "live-presence"/);
  assert.match(realtimeHookSource, /\bliveCount\b/);
});
