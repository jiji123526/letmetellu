import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatViewSource = readFileSync(
  new URL("../../src/components/chat/ChatView.tsx", import.meta.url),
  "utf8",
);
const topChromeSource = readFileSync(
  new URL("../../src/components/chat/ChatViewTopChrome.tsx", import.meta.url),
  "utf8",
);
const globalStylesSource = readFileSync(
  new URL("../../src/app/globals.css", import.meta.url),
  "utf8",
);

test("chat uses only visual viewport height during keyboard resize", () => {
  assert.match(chatViewSource, /const viewport = window\.visualViewport/);
  assert.match(chatViewSource, /root\.style\.height = `\$\{viewport\.height\}px`/);
  assert.match(chatViewSource, /viewport\.addEventListener\("resize", syncViewport\)/);
  assert.match(chatViewSource, /viewport\.removeEventListener\("resize", syncViewport\)/);
  assert.doesNotMatch(chatViewSource, /viewport\.pageTop/);
  assert.doesNotMatch(chatViewSource, /viewport\.offsetTop/);
  assert.doesNotMatch(chatViewSource, /viewport\.addEventListener\("scroll"/);
  assert.doesNotMatch(chatViewSource, /document\.activeElement !== textarea/);
  assert.doesNotMatch(chatViewSource, /--chat-keyboard-inset/);
  assert.doesNotMatch(chatViewSource, /--chat-header-offset/);
  assert.doesNotMatch(chatViewSource, /--chat-viewport-height/);
  assert.doesNotMatch(chatViewSource, /--chat-viewport-top/);
});

test("chat is one fixed flex frame containing header, messages, and composer", () => {
  assert.match(chatViewSource, /className="fixed inset-x-0 top-0 max-w-\[480px\]/);
  assert.match(chatViewSource, /height: "100dvh"/);
  assert.doesNotMatch(chatViewSource, /data-chat-stationary-header/);
  assert.doesNotMatch(chatViewSource, /data-chat-keyboard-content/);
  assert.doesNotMatch(chatViewSource, /translate3d\(0, var\(--chat-header-offset/);
  assert.doesNotMatch(chatViewSource, /paddingBottom: "var\(--chat-keyboard-inset/);
});

test("header remains a normal non-shrinking row in the chat frame", () => {
  assert.match(
    topChromeSource,
    /className="relative flex w-full flex-none items-center/,
  );
  assert.doesNotMatch(topChromeSource, /ResizeObserver/);
  assert.doesNotMatch(topChromeSource, /headerHeight/);
  assert.doesNotMatch(topChromeSource, /visualViewport/);
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
  assert.match(chatViewSource, /body\.addEventListener\("touchmove", preventDocumentPan, \{ passive: false \}\)/);
  assert.match(chatViewSource, /element\.scrollHeight > element\.clientHeight/);
  assert.match(chatViewSource, /body\.removeEventListener\("touchmove", preventDocumentPan\)/);
  assert.match(chatViewSource, /html\.style\.overflow = previousHtmlOverflow/);
  assert.doesNotMatch(chatViewSource, /body\.style\.position = "fixed"/);
});

test("Chromium requests content resizing for interactive keyboards", () => {
  const layoutSource = readFileSync(
    new URL("../../src/app/layout.tsx", import.meta.url),
    "utf8",
  );
  assert.match(layoutSource, /interactiveWidget: "resizes-content"/);
});

test("focused mobile layouts remove footer padding in browser and standalone modes", () => {
  assert.match(
    globalStylesSource,
    /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?padding-bottom: 0 !important/,
  );
  assert.doesNotMatch(globalStylesSource, /@media \(display-mode: standalone\)/);
});
