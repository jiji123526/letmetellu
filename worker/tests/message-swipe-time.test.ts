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

test("message rows cancel long press and reveal the timestamp during horizontal swipe", () => {
  const source = readFileSync(
    new URL("../../src/components/chat/ChatMessageList.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /gesture\.axis = "horizontal";[\s\S]*onTouchEnd\(\)/);
  assert.match(source, /const \[sharedSwipe, setSharedSwipe\] = React\.useState<SwipeRevealState>/);
  assert.match(source, /const swipeActive = sharedSwipe\.revealOffset > 0/);
  assert.match(source, /const swipeOffset = swipeActive[\s\S]*messageSide === "sent" \? -sharedSwipe\.revealOffset : sharedSwipe\.revealOffset/);
  assert.match(source, /const sentTime = swipeActive \? chatTimeLabel\(msg\.created_at, locale, timeZone\) : ""/);
  assert.match(source, /onSwipeMove\(Math\.abs\(nextOffset\)\)/);
  assert.match(source, /color: markerColor/);
  assert.match(source, /<div className="relative w-full">[\s\S]*\{sentTime\}[\s\S]*style=\{swipeTransformStyle\}/);
  assert.match(source, /<div style=\{swipeTransformStyle\}>[\s\S]*<ReactionBadge/);
  assert.match(source, /touchAction: "pan-y"/);
  assert.doesNotMatch(source, /const \[swipeOffset, setSwipeOffset\]/);
});
