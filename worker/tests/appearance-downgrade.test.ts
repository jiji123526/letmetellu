import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyFreeChannelAppearance,
  hasPremiumChannelAppearance,
  resetPersistedChannelAppearanceIfNeeded,
} from "../src/lib/channel-appearance.ts";

test("free appearance sanitizer resets premium channel appearance to defaults", () => {
  assert.deepEqual(
    applyFreeChannelAppearance({
      bubble_color: "#112233",
      background_type: "image",
      background_color: "#abcdef",
      background_image: "/api/media/room/premium-bg.jpg",
      background_overlay: 28,
      background_blur: 1,
    }),
    {
      bubble_color: "#3598fe",
      background_type: "default",
      background_color: null,
      background_image: null,
      background_overlay: 14,
      background_blur: 0,
    },
  );
  assert.equal(hasPremiumChannelAppearance({
    bubble_color: "#3598fe",
    background_type: "default",
    background_color: null,
    background_image: null,
    background_overlay: 14,
    background_blur: 0,
  }), false);
  assert.equal(hasPremiumChannelAppearance({
    bubble_color: "#112233",
  }), true);
});

test("persisted appearance reset clears premium fields without deleting media objects directly", async () => {
  const queries: string[] = [];
  const env = {
    DB: {
      prepare(query: string) {
        queries.push(query);
        return {
          bind() {
            return {
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
              async first() {
                return null;
              },
            };
          },
        };
      },
    },
  };

  const changed = await resetPersistedChannelAppearanceIfNeeded(
    env as never,
    "channel-1",
    {
      bubble_color: "#112233",
      background_type: "image",
      background_image: "/api/media/room/premium-bg.jpg",
      background_overlay: 24,
      background_blur: 1,
    },
  );

  assert.equal(changed, true);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /UPDATE channels/);
  assert.match(queries[0], /background_image = NULL/);
  assert.doesNotMatch(queries[0], /DELETE/i);
});

test("downgrade wiring preserves locked appearance and resets only the retained channel", () => {
  const initRouteSource = readFileSync(
    new URL("../src/routes/init.ts", import.meta.url),
    "utf8",
  );
  const userRouteSource = readFileSync(
    new URL("../src/routes/user.ts", import.meta.url),
    "utf8",
  );
  const channelStateSource = readFileSync(
    new URL("../src/routes/channel-state.ts", import.meta.url),
    "utf8",
  );
  const bootstrapSource = readFileSync(
    new URL("../../src/components/chat/useChatChannelBootstrap.ts", import.meta.url),
    "utf8",
  );

  assert.match(initRouteSource, /resetPersistedChannelAppearanceIfNeeded\(env, parentChannelId, channel\)/);
  assert.match(initRouteSource, /channel = applyFreeChannelAppearance\(channel\)/);
  assert.match(
    userRouteSource,
    /resetPersistedChannelAppearanceIfNeeded\(env, channelRetention\.retainedChannelId\)/,
  );
  assert.doesNotMatch(userRouteSource, /resetOwnedChannelAppearancesIfNeeded/);
  assert.match(userRouteSource, /activePlusEntitlement \? channel : applyFreeChannelAppearance\(channel\)/);
  assert.match(channelStateSource, /appearance_version: getChannelAppearanceVersion\(responseAppearance\)/);
  assert.match(bootstrapSource, /function reconcileBubbleOverride/);
  assert.match(bootstrapSource, /localStorage\.removeItem\(`bubbleColor_\$\{channelId\}`\)/);
  assert.match(bootstrapSource, /clearedStaleOverride/);
});
