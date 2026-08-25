import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatViewSource = readFileSync(
  new URL("../../src/components/chat/ChatView.tsx", import.meta.url),
  "utf8",
);

test("focused chat composer follows the mobile visual viewport", () => {
  assert.match(chatViewSource, /const viewport = window\.visualViewport/);
  assert.match(chatViewSource, /document\.activeElement !== textarea/);
  assert.match(chatViewSource, /--chat-viewport-height/);
  assert.match(chatViewSource, /viewport\.addEventListener\("resize", syncViewport\)/);
  assert.match(chatViewSource, /viewport\.removeEventListener\("resize", syncViewport\)/);
  assert.doesNotMatch(chatViewSource, /--chat-viewport-top/);
  assert.doesNotMatch(chatViewSource, /viewport\.addEventListener\("scroll", syncViewport\)/);
});

test("chat shell stays fixed and preserves the latest-message bottom distance", () => {
  assert.match(chatViewSource, /className="fixed inset-x-0 max-w-\[480px\]/);
  assert.match(chatViewSource, /top: "0px"/);
  assert.match(chatViewSource, /height: "var\(--chat-viewport-height, 100dvh\)"/);
  assert.match(chatViewSource, /bottomDistance <= 120/);
  assert.match(
    chatViewSource,
    /scrollRoot\.scrollTop =\s*scrollRoot\.scrollHeight - scrollRoot\.clientHeight - bottomDistance/,
  );
});
