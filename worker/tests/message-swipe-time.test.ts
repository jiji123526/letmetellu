import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { chatTimeLabel } from "../../src/lib/chat-date.ts";
import {
  isHorizontalMessageSwipe,
  messageSwipeOffset,
} from "../../src/components/chat/messageSwipe.ts";

test("message swipe follows the bubble side and stays bounded", () => {
  assert.equal(messageSwipeOffset(30, false), 30);
  assert.equal(messageSwipeOffset(-30, false), 0);
  assert.equal(messageSwipeOffset(-30, true), -30);
  assert.equal(messageSwipeOffset(30, true), 0);
  assert.equal(messageSwipeOffset(500, false), 56);
  assert.equal(messageSwipeOffset(-500, true), -56);
});

test("vertical scrolling does not activate a message swipe", () => {
  assert.equal(isHorizontalMessageSwipe(20, 5), true);
  assert.equal(isHorizontalMessageSwipe(5, 20), false);
  assert.equal(isHorizontalMessageSwipe(4, 0), false);
});

test("message times use the viewer timezone", () => {
  const utc = chatTimeLabel("2026-08-18 12:05:00", "en", "UTC");
  const losAngeles = chatTimeLabel(
    "2026-08-18 12:05:00",
    "en",
    "America/Los_Angeles",
  );
  assert.match(utc, /12:05/);
  assert.match(losAngeles, /5:05/);
  assert.notEqual(utc, losAngeles);
});

test("message time labels cache formatted results by timestamp and viewer locale", () => {
  const source = readFileSync(
    new URL("../../src/lib/chat-date.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /const chatTimeLabelCache = new Map<string, string>\(\)/);
  assert.match(source, /const labelKey = `\$\{value\}:\$\{locale\}:\$\{timeZone\}`/);
  assert.match(source, /chatTimeLabelCache\.get\(labelKey\)/);
  assert.match(source, /chatTimeLabelCache\.set\(labelKey, label\)/);
});

test("message pane owns swipe detection and rows only render side-filtered timestamps", () => {
  const paneSource = readFileSync(
    new URL("../../src/components/chat/ChatViewMessagePane.tsx", import.meta.url),
    "utf8",
  );
  const listSource = readFileSync(
    new URL("../../src/components/chat/ChatMessageList.tsx", import.meta.url),
    "utf8",
  );

  assert.match(paneSource, /const \[sharedSwipe, setSharedSwipe\] = useState<SwipeRevealState>/);
  assert.match(paneSource, /event\.target instanceof HTMLElement[\s\S]*closest<HTMLElement>\("\[data-message-row\]"\)/);
  assert.match(paneSource, /gesture\.axis = "horizontal";[\s\S]*onTouchEnd\(\)/);
  assert.match(paneSource, /const nextOffset = messageSwipeOffset\(deltaX, gesture\.side === "sent"\)/);
  assert.match(paneSource, /onTouchStart=\{handleContainerTouchStart\}/);
  assert.match(paneSource, /onTouchMove=\{handleContainerTouchMove\}/);
  assert.match(paneSource, /onTouchEnd=\{finishSwipe\}/);
  assert.match(paneSource, /sharedSwipe=\{sharedSwipe\}/);

  assert.match(listSource, /data-message-row/);
  assert.match(listSource, /data-message-side=\{messageSide\}/);
  assert.match(listSource, /const swipeActive = sharedSwipe\.revealOffset > 0/);
  assert.match(listSource, /const swipeOffset = swipeActive[\s\S]*sharedSwipe\.side === "sent" \? -sharedSwipe\.revealOffset : sharedSwipe\.revealOffset/);
  assert.match(listSource, /const showTimestamp = swipeActive && sharedSwipe\.side === messageSide/);
  assert.match(listSource, /const sentTime = showTimestamp \? chatTimeLabel\(msg\.created_at, locale, timeZone\) : ""/);
  assert.match(listSource, /color: markerColor/);
  assert.match(listSource, /<div className="relative w-full">[\s\S]*\{sentTime\}[\s\S]*style=\{swipeTransformStyle\}/);
  assert.match(listSource, /<div style=\{swipeTransformStyle\}>[\s\S]*<ReactionBadge/);
  assert.match(listSource, /touchAction: "pan-y"/);
  assert.doesNotMatch(listSource, /const \[swipeOffset, setSwipeOffset\]/);
  assert.doesNotMatch(listSource, /swipeGestureRef/);
});
