import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getLiveSessionEndDisposition,
} from "../src/lib/live-session-end.ts";

test("live session ending distinguishes matching, stale and ended state", () => {
  assert.equal(
    getLiveSessionEndDisposition("current-session", "current-session"),
    "end",
  );
  assert.equal(
    getLiveSessionEndDisposition("current-session", "stale-session"),
    "session_changed",
  );
  assert.equal(
    getLiveSessionEndDisposition(null, "old-session"),
    "already_ended",
  );
});

test("live reconnect and websocket presence remain session-aware", () => {
  const realtimeSource = readFileSync(
    new URL("../../src/components/chat/useChatRealtimeSync.ts", import.meta.url),
    "utf8",
  );
  const chatRoomSource = readFileSync(
    new URL("../src/realtime/chat-room.ts", import.meta.url),
    "utf8",
  );
  const adminSource = readFileSync(
    new URL("../src/routes/admin.ts", import.meta.url),
    "utf8",
  );
  const liveSessionSource = readFileSync(
    new URL("../src/lib/live-sessions.ts", import.meta.url),
    "utf8",
  );

  assert.match(realtimeSource, /await reconcileCurrentLiveSession\(traceCycleId\)/);
  assert.match(realtimeSource, /send\(\{ type: "join-live", sessionId: result\.sessionId \}\)/);
  assert.match(chatRoomSource, /getLiveJoinDisposition\(liveSession, requestedSessionId\)/);
  assert.match(chatRoomSource, /connection\.inLive = false/);
  assert.match(adminSource, /error: "missing_live_session_id"/);
  assert.match(adminSource, /error: "live_session_changed"/);
  assert.match(liveSessionSource, /WHERE id = \? AND text = \?/);
});
