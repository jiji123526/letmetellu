import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMediaDimensions } from "../src/lib/media-dimensions.ts";

const messageContentSource = readFileSync(
  new URL("../../src/components/chat/ChatMessageContent.tsx", import.meta.url),
  "utf8",
);
const globalStylesSource = readFileSync(
  new URL("../../src/app/globals.css", import.meta.url),
  "utf8",
);
const messageListSource = readFileSync(
  new URL("../../src/components/chat/ChatMessageList.tsx", import.meta.url),
  "utf8",
);
const messagePaneSource = readFileSync(
  new URL("../../src/components/chat/ChatViewMessagePane.tsx", import.meta.url),
  "utf8",
);
const mutationSource = readFileSync(
  new URL("../../src/components/chat/useChatMessageMutations.ts", import.meta.url),
  "utf8",
);
const messageRouteSource = readFileSync(
  new URL("../src/routes/messages.ts", import.meta.url),
  "utf8",
);
const dmRouteSource = readFileSync(
  new URL("../src/routes/dm.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL("../migrations/0050_dm_media_dimensions.sql", import.meta.url),
  "utf8",
);

test("media dimensions accept only complete bounded integer pairs", () => {
  assert.deepEqual(parseMediaDimensions({}), null);
  assert.deepEqual(parseMediaDimensions({ image_w: 1200, image_h: 800 }), {
    width: 1200,
    height: 800,
  });
  assert.equal(parseMediaDimensions({ image_w: 1200 }), undefined);
  assert.equal(parseMediaDimensions({ image_w: 0, image_h: 800 }), undefined);
  assert.equal(parseMediaDimensions({ image_w: 1200.5, image_h: 800 }), undefined);
  assert.equal(parseMediaDimensions({ image_w: 1200, image_h: 10_001 }), undefined);
});

test("direct message images reserve geometry and activate near the chat viewport", () => {
  assert.match(messageContentSource, /aspectRatio: `\$\{Number\(width\)\} \/ \$\{Number\(height\)\}`/);
  assert.match(messageContentSource, /target\.closest<HTMLElement>\("\.messages-scroll"\)/);
  assert.match(messageContentSource, /messageImageObserverGroups = new WeakMap/);
  assert.match(messageContentSource, /function observeMessageImage\(/);
  assert.match(messageContentSource, /new IntersectionObserver\(/);
  assert.match(messageContentSource, /rootMargin: getMessageImageRootMargin\(\)/);
  assert.match(messageContentSource, /src=\{shouldLoad \? src : undefined\}/);
  assert.match(messageContentSource, /eager \|\| !hasStableDimensions/);
  assert.match(messageContentSource, /const READY_MESSAGE_IMAGE_LIMIT = 500/);
  assert.match(messageContentSource, /function rememberReadyMessageImage\(src: string\)/);
  assert.match(messageContentSource, /rememberReadyMessageImage\(src\)/);
  assert.match(messageContentSource, /const initiallyReady = readyMessageImages\.has\(src\)/);
  assert.match(messageContentSource, /const \[loaded, setLoaded\] = useState\(initiallyReady\)/);
  assert.match(messageContentSource, /hasStableDimensions \? \([\s\S]*media-loading-skeleton/);
  assert.match(messageContentSource, /<MediaLoadingDots \/>/);
  assert.match(messageContentSource, /image\.decode\(\)/);
  assert.match(messageContentSource, /media-load-fade/);
  assert.match(messageContentSource, /media-load-failure/);
  assert.match(globalStylesSource, /@keyframes media-skeleton-pulse/);
  assert.match(globalStylesSource, /prefers-reduced-motion: reduce/);
  assert.match(messageListSource, /width=\{msg\.image_w\}/);
  assert.match(messageListSource, /height=\{msg\.image_h\}/);
});

test("gallery staging keeps its bounded image context eager", () => {
  const stagedList = messagePaneSource.match(
    /data-gallery-navigation-stage[\s\S]*?<\/div>\s*\n\s*<main/,
  )?.[0] || "";
  assert.match(stagedList, /<MessageList[\s\S]*?eagerMedia/);
  assert.equal((messagePaneSource.match(/\beagerMedia\b/g) || []).length, 1);
});

test("send paths persist dimensions for messages, DM roots and DM replies", () => {
  assert.match(mutationSource, /image_w: photos\[index\]\.width/);
  assert.match(mutationSource, /image_w: photos\[0\]\?\.width/);
  assert.match(messageRouteSource, /INSERT INTO messages[\s\S]*image_w, image_h/);
  assert.match(dmRouteSource, /INSERT INTO dm \([\s\S]*image_w, image_h/);
  assert.match(dmRouteSource, /INSERT INTO dm_replies[\s\S]*image_w, image_h/);
  assert.match(migrationSource, /ALTER TABLE dm ADD COLUMN image_w INTEGER/);
  assert.match(migrationSource, /ALTER TABLE dm_replies ADD COLUMN image_h INTEGER/);
});
