import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const historyNavigationSource = readFileSync(
  new URL("../../src/components/chat/useChatHistoryNavigation.ts", import.meta.url),
  "utf8",
);

test("in-channel refresh snapshots a bounded source-qualified scroll anchor", () => {
  assert.match(historyNavigationSource, /SCROLL_POSITION_SAVE_INTERVAL_MS = 150/);
  assert.match(historyNavigationSource, /const anchor = findScrollAnchor\(container\)/);
  assert.match(historyNavigationSource, /source: unifiedTimelineItemsRef\.current\?\.find/);
  assert.match(historyNavigationSource, /scheduleScrollPositionSave\(\)/);
  assert.match(historyNavigationSource, /if \(!scrollPositionTrackingReadyRef\.current \|\| scrollPositionSaveTimerRef\.current\) return/);
  assert.match(historyNavigationSource, /scrollPositionTrackingReadyRef\.current = true/);
  assert.match(historyNavigationSource, /window\.addEventListener\("beforeunload", handlePageExit\)/);
  assert.match(historyNavigationSource, /window\.addEventListener\("pagehide", handlePageExit\)/);
  assert.match(historyNavigationSource, /if \(navigation\?\.type !== "reload"\) return false/);
  assert.match(historyNavigationSource, /position\.live !== inLiveModeRef\.current/);
  assert.match(historyNavigationSource, /Date\.now\(\) - position\.savedAt > SCROLL_POSITION_MAX_AGE_MS/);
});
