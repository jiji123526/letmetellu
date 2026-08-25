import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatViewSource = readFileSync(
  new URL("../../src/components/chat/ChatView.tsx", import.meta.url),
  "utf8",
);
const globalStylesSource = readFileSync(
  new URL("../../src/app/globals.css", import.meta.url),
  "utf8",
);

test("focused chat composer follows the mobile visual viewport", () => {
  assert.match(chatViewSource, /const viewport = window\.visualViewport/);
  assert.match(chatViewSource, /document\.activeElement !== textarea/);
  assert.match(chatViewSource, /root\.style\.top = `\$\{viewport\.pageTop\}px`/);
  assert.match(chatViewSource, /root\.style\.height = `\$\{viewport\.height\}px`/);
  assert.match(chatViewSource, /viewport\.addEventListener\("resize", syncViewport\)/);
  assert.match(chatViewSource, /viewport\.removeEventListener\("resize", syncViewport\)/);
  assert.doesNotMatch(chatViewSource, /--chat-keyboard-inset/);
  assert.doesNotMatch(chatViewSource, /--chat-header-offset/);
  assert.doesNotMatch(chatViewSource, /--chat-viewport-height/);
  assert.doesNotMatch(chatViewSource, /--chat-viewport-top/);
  assert.match(chatViewSource, /viewport\.addEventListener\("scroll", syncViewport\)/);
  assert.match(chatViewSource, /viewport\.removeEventListener\("scroll", syncViewport\)/);
});

test("stationary top chrome is isolated from keyboard-aware chat content", () => {
  assert.match(chatViewSource, /className="absolute inset-x-0 max-w-\[480px\]/);
  assert.match(chatViewSource, /top: "0px"/);
  assert.match(chatViewSource, /height: "100dvh"/);
  assert.match(chatViewSource, /data-chat-stationary-header/);
  assert.match(chatViewSource, /data-chat-keyboard-content/);
  assert.doesNotMatch(chatViewSource, /translate3d\(0, var\(--chat-header-offset/);
  assert.doesNotMatch(chatViewSource, /paddingBottom: "var\(--chat-keyboard-inset/);
});

test("keyboard-aware content preserves the latest-message bottom distance", () => {
  assert.match(chatViewSource, /bottomDistance <= 120/);
  assert.match(
    chatViewSource,
    /scrollRoot\.scrollTop =\s*scrollRoot\.scrollHeight - scrollRoot\.clientHeight - bottomDistance/,
  );
});

test("loaded chat locks document scrolling and restores prior styles", () => {
  assert.match(chatViewSource, /html\.style\.overflow = "hidden"/);
  assert.match(chatViewSource, /body\.style\.overflow = "hidden"/);
  assert.match(chatViewSource, /html\.style\.overflow = previousHtmlOverflow/);
  assert.doesNotMatch(chatViewSource, /body\.style\.position = "fixed"/);
});

test("focused mobile layouts remove footer padding in browser and standalone modes", () => {
  assert.match(
    globalStylesSource,
    /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?padding-bottom: 0 !important/,
  );
  assert.doesNotMatch(globalStylesSource, /@media \(display-mode: standalone\)/);
});
