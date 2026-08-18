import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatView = readFileSync(new URL("../../src/components/chat/ChatView.tsx", import.meta.url), "utf8");
const topChrome = readFileSync(new URL("../../src/components/chat/ChatViewTopChrome.tsx", import.meta.url), "utf8");

test("hidden channels disable owner-profile navigation", () => {
  assert.match(chatView, /channel\?\.show_on_profile === 1[\s\S]*channel\.owner_channel_count \|\| 0[\s\S]*: 0/);
  assert.match(topChrome, /disabled=\{ownerChannelCount < 2\}/);
  assert.match(topChrome, /cursor: ownerChannelCount >= 2 \? "pointer" : "default"/);
});
