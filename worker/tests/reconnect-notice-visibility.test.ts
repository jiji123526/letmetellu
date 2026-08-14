import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { shouldShowReconnectNotice } from "../../src/components/chat/chatConnectionNotice.ts";

const chatViewSource = readFileSync(
  new URL("../../src/components/chat/ChatView.tsx", import.meta.url),
  "utf8",
);
const historySource = readFileSync(
  new URL("../../src/components/chat/useChatHistoryNavigation.ts", import.meta.url),
  "utf8",
);

test("reconnect notice appears at the normal chat live edge", () => {
  assert.equal(shouldShowReconnectNotice({
    reconnectPending: true,
    historyMode: "latest",
    isNearBottom: true,
    inLiveMode: false,
    dmMode: false,
  }), true);
});

test("reconnect notice stays hidden while reading rendered history", () => {
  assert.equal(shouldShowReconnectNotice({
    reconnectPending: true,
    historyMode: "latest",
    isNearBottom: false,
    inLiveMode: false,
    dmMode: false,
  }), false);
  assert.equal(shouldShowReconnectNotice({
    reconnectPending: true,
    historyMode: "context",
    isNearBottom: true,
    inLiveMode: false,
    dmMode: false,
  }), false);
});

test("reconnect notice remains visible for active live and DM interactions", () => {
  assert.equal(shouldShowReconnectNotice({
    reconnectPending: true,
    historyMode: "context",
    isNearBottom: false,
    inLiveMode: true,
    dmMode: false,
  }), true);
  assert.equal(shouldShowReconnectNotice({
    reconnectPending: true,
    historyMode: "context",
    isNearBottom: false,
    inLiveMode: false,
    dmMode: true,
  }), true);
});

test("reconnect notice never appears without a pending reconnect", () => {
  assert.equal(shouldShowReconnectNotice({
    reconnectPending: false,
    historyMode: "latest",
    isNearBottom: true,
    inLiveMode: true,
    dmMode: true,
  }), false);
});

test("chat view gates the socket notice with reactive history position", () => {
  assert.match(historySource, /const \[isNearBottom, setIsNearBottom\] = useState\(true\)/);
  assert.match(chatViewSource, /const reconnectNoticeVisible = shouldShowReconnectNotice\(/);
  assert.match(chatViewSource, /showReconnectNotice=\{reconnectNoticeVisible\}/);
});
