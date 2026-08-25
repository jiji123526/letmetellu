import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composerSource = readFileSync(
  new URL("../../src/components/chat/useChatComposerState.ts", import.meta.url),
  "utf8",
);
const bottomShellSource = readFileSync(
  new URL("../../src/components/chat/ChatViewBottomShell.tsx", import.meta.url),
  "utf8",
);
const chatViewSource = readFileSync(
  new URL("../../src/components/chat/ChatView.tsx", import.meta.url),
  "utf8",
);

test("all photo entry points share the bounded composer ingestion path", () => {
  assert.match(composerSource, /SUPPORTED_PHOTO_TYPES = new Set\(\[[\s\S]*"image\/jpeg"[\s\S]*"image\/png"[\s\S]*"image\/gif"[\s\S]*"image\/webp"/);
  assert.match(composerSource, /const queued = ingestionQueueRef\.current\.then\(run, run\)/);
  assert.match(composerSource, /maxFiles - pendingPhotosRef\.current\.length/);
  assert.match(composerSource, /photo\.blob\.size > MAX_PHOTO_BYTES/);
  assert.match(bottomShellSource, /accept="image\/jpeg,image\/png,image\/gif,image\/webp"/);
  assert.match(bottomShellSource, /void onPhotoFiles\(files, photoOptions\)/);
  assert.match(chatViewSource, /effectiveAdmin && !!replyingTo\?\.dm[\s\S]*maxFiles: 1/);
});

test("clipboard image paste preserves accompanying plain text", () => {
  assert.match(bottomShellSource, /event\.clipboardData\.items/);
  assert.match(bottomShellSource, /item\.kind === "file"/);
  assert.match(
    bottomShellSource,
    /if \(!event\.clipboardData\.getData\("text\/plain"\)\) \{\s*event\.preventDefault\(\)/,
  );
  assert.match(bottomShellSource, /onPaste=\{handlePaste\}/);
});

test("whole-chat drop prevents browser navigation and respects blocked composers", () => {
  assert.match(chatViewSource, /onDragEnter=\{handlePhotoDragEnter\}/);
  assert.match(chatViewSource, /onDragOver=\{handlePhotoDragOver\}/);
  assert.match(chatViewSource, /onDragLeave=\{handlePhotoDragLeave\}/);
  assert.match(chatViewSource, /onDrop=\{handlePhotoDrop\}/);
  assert.match(chatViewSource, /handlePhotoDragOver[\s\S]*event\.preventDefault\(\)/);
  assert.match(chatViewSource, /handlePhotoDrop[\s\S]*event\.preventDefault\(\)/);
  assert.match(chatViewSource, /photoDragDepthRef\.current \+= 1/);
  assert.match(chatViewSource, /if \(composerMediaDisabled\) return/);
  assert.match(chatViewSource, /void addComposerPhotoFiles\(Array\.from\(event\.dataTransfer\.files\)\)/);
});

test("drop feedback is unobtrusive and follows the active bubble color", () => {
  const dropIndicator = chatViewSource.match(
    /\{isPhotoDragActive && \([\s\S]*?\n      \)\}/,
  )?.[0] || "";
  assert.match(dropIndicator, /absolute inset-2/);
  assert.match(dropIndicator, /bottom: "calc\(68px \+ env\(safe-area-inset-bottom\)\)"/);
  assert.match(dropIndicator, /\$\{bubbleColor\}/);
  assert.doesNotMatch(dropIndicator, /backdropFilter|WebkitBackdropFilter/);
  assert.doesNotMatch(dropIndicator, /background: "color-mix\(in srgb, var\(--bg\) 72%/);
});
