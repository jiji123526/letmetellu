import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  completeChatPerformanceCycle,
  startChatPerformanceCycle,
} from "../../src/lib/chat-performance.ts";

test("superseded chat performance cycles terminate instead of remaining pending", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });

  try {
    const cycleId = startChatPerformanceCycle("cold-start-test", "bootstrap");
    completeChatPerformanceCycle("cold-start-test", cycleId, "superseded");
    const cycle = window.__letmetelluChatPerf?.["cold-start-test"]?.cycles[0];
    assert.equal(cycle?.outcome, "superseded");
    assert.equal(typeof cycle?.completedAtMs, "number");
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});

test("noncritical chat UI remains outside eager imports", () => {
  const overlays = readFileSync(
    new URL("../../src/components/chat/ChatViewOverlays.tsx", import.meta.url),
    "utf8",
  );
  const topChrome = readFileSync(
    new URL("../../src/components/chat/ChatViewTopChrome.tsx", import.meta.url),
    "utf8",
  );
  const layerStack = readFileSync(
    new URL("../../src/components/chat/ChatViewLayerStack.tsx", import.meta.url),
    "utf8",
  );
  const messageContent = readFileSync(
    new URL("../../src/components/chat/ChatMessageContent.tsx", import.meta.url),
    "utf8",
  );

  assert.match(overlays, /dynamic\(\(\) => import\("\.\.\/admin\/AdminPanel"\)/);
  assert.match(overlays, /dynamic\(\(\) => import\("\.\/GalleryPanel"\)/);
  assert.match(overlays, /dynamic\(\(\) => import\("\.\/LinksPanel"\)/);
  assert.match(overlays, /dynamic\(\(\) => import\("\.\/SettingsPanel"\)/);
  assert.match(topChrome, /dynamic\(\(\) => import\("\.\/SearchBar"\)/);
  assert.match(topChrome, /dynamic\(\(\) => import\("\.\/EditDialog"\)/);
  assert.match(layerStack, /dynamic\(\(\) => import\("\.\/ContextMenu"\)/);
  assert.match(messageContent, /from "\.\/search-highlight"/);
  assert.doesNotMatch(messageContent, /from "\.\/SearchBar"/);
});
