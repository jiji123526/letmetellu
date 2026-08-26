import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getChannelAppearanceVersion } from "../src/lib/channel-appearance.ts";

test("appearance versions change when bubble or background fields change", () => {
  const base = getChannelAppearanceVersion({
    bubble_color: "#112233",
    background_type: "image",
    background_image: "/api/media/room/bg.jpg",
    background_overlay: 26,
    background_blur: 1,
  });
  assert.match(base, /^v1-[0-9a-f]{8}$/);
  assert.notEqual(base, getChannelAppearanceVersion({
    bubble_color: "#445566",
    background_type: "image",
    background_image: "/api/media/room/bg.jpg",
    background_overlay: 26,
    background_blur: 1,
  }));
  assert.notEqual(base, getChannelAppearanceVersion({
    bubble_color: "#112233",
    background_type: "image",
    background_image: "/api/media/room/bg.jpg",
    background_overlay: 27,
    background_blur: 1,
  }));
});

test("client appearance cache stores a versioned snapshot and migrates the legacy background entry", () => {
  const cacheSource = readFileSync(
    new URL("../../src/lib/channel-background-cache.ts", import.meta.url),
    "utf8",
  );
  assert.match(cacheSource, /export interface ChannelAppearanceSnapshot extends ChannelBackgroundSnapshot/);
  assert.match(cacheSource, /bubbleColor: string/);
  assert.match(cacheSource, /appearanceVersion: string/);
  assert.match(cacheSource, /parsed\?\.version === 1 && isSnapshot\(parsed\.background\)/);
  assert.match(cacheSource, /appearanceVersion: source\.appearance_version \|\| getChannelAppearanceVersion\(source\)/);
  assert.match(cacheSource, /update\.appearance_version \|\| getChannelAppearanceVersion\(/);
});

test("bootstrap and realtime paths now preserve cached appearance until the server version changes", () => {
  const bootstrapSource = readFileSync(
    new URL("../../src/components/chat/useChatChannelBootstrap.ts", import.meta.url),
    "utf8",
  );
  const realtimeSource = readFileSync(
    new URL("../../src/components/chat/useChatRealtimeSync.ts", import.meta.url),
    "utf8",
  );
  const settingsSource = readFileSync(
    new URL("../../src/components/chat/useChatChannelSettings.ts", import.meta.url),
    "utf8",
  );
  const initRouteSource = readFileSync(
    new URL("../src/routes/init.ts", import.meta.url),
    "utf8",
  );
  const adminRouteSource = readFileSync(
    new URL("../src/routes/admin.ts", import.meta.url),
    "utf8",
  );

  assert.match(bootstrapSource, /const cachedAppearance = readChannelAppearance\(channelId\)/);
  assert.match(bootstrapSource, /cachedAppearance\.appearanceVersion !== data\.channel\.appearance_version/);
  assert.match(bootstrapSource, /storeChannelAppearance\(channelId, data\.channel\)/);

  assert.match(realtimeSource, /patchChannelAppearance\(channelId, \{/);
  assert.match(realtimeSource, /appearance_version: event\.appearance_version as string \| undefined/);

  assert.match(settingsSource, /const appearanceVersion = getChannelAppearanceVersion\(nextAppearance\)/);
  assert.match(settingsSource, /appearance_version: appearanceVersion/);
  assert.match(settingsSource, /patchChannelAppearance\(channelId, \{/);

  assert.match(initRouteSource, /safeChannel\.appearance_version = getChannelAppearanceVersion/);
  assert.match(adminRouteSource, /const appearanceVersion = hasAppearanceUpdate/);
  assert.match(adminRouteSource, /appearance_version: appearanceVersion/);
});

test("chat entry paints the authoritative background beneath its retained loading surface", () => {
  const cacheSource = readFileSync(
    new URL("../../src/lib/channel-background-cache.ts", import.meta.url),
    "utf8",
  );
  const bootstrapSource = readFileSync(
    new URL("../../src/components/chat/useChatChannelBootstrap.ts", import.meta.url),
    "utf8",
  );
  const chatViewSource = readFileSync(
    new URL("../../src/components/chat/ChatView.tsx", import.meta.url),
    "utf8",
  );

  assert.match(cacheSource, /BACKGROUND_PREPARE_TIMEOUT_MS = 2_000/);
  assert.match(cacheSource, /backgroundPreparationCache = new Map<string, Promise<boolean>>/);
  assert.match(cacheSource, /export async function prepareChannelBackground/);
  assert.match(cacheSource, /image\.decode\(\)\.catch/);
  assert.match(cacheSource, /export async function waitForChannelBackgroundPaint/);
  assert.match(cacheSource, /secondFrame = requestAnimationFrame\(finish\)/);
  assert.match(bootstrapSource, /const backgroundReady = prepareChannelBackground\(data\.channel\)/);
  assert.match(bootstrapSource, /await prepareChannelBackground\(normalData\.channel\)/);
  assert.match(bootstrapSource, /await backgroundReady;[\s\S]*await waitForChannelBackgroundPaint\(\);[\s\S]*setLoading\(false\)/);
  assert.match(chatViewSource, /const backgroundReady = prepareChannelBackground\(data\.channel\)/);
  assert.match(chatViewSource, /if \(loading && !channel\)/);
  assert.match(chatViewSource, /\{loading && \([\s\S]*<ChatViewLoadingState background=\{cachedBackground\} \/>/);
  assert.match(chatViewSource, /await backgroundReady;[\s\S]*await waitForChannelBackgroundPaint\(\);[\s\S]*setLoading\(false\)/);
});
