import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_BACKGROUND_OVERLAY,
  DEFAULT_BUBBLE_COLOR,
  FREE_OWNED_CHANNEL_LIMIT,
  getOwnedChannelLimit,
  isPremiumAppearanceWrite,
  PLUS_OWNED_CHANNEL_LIMIT,
} from "../src/lib/plan-feature-gates.ts";

const adminSource = readFileSync(
  new URL("../src/routes/admin.ts", import.meta.url),
  "utf8",
);

test("plan feature gates expose the chosen free and plus ownership limits", () => {
  assert.equal(FREE_OWNED_CHANNEL_LIMIT, 1);
  assert.equal(PLUS_OWNED_CHANNEL_LIMIT, 5);
  assert.equal(getOwnedChannelLimit(false), 1);
  assert.equal(getOwnedChannelLimit(true), 5);
});

test("premium appearance gate ignores default resets but catches paid-only customization writes", () => {
  assert.equal(isPremiumAppearanceWrite({
    bubbleColor: DEFAULT_BUBBLE_COLOR,
    backgroundType: "default",
    backgroundColor: null,
    backgroundImage: null,
    backgroundOverlay: DEFAULT_BACKGROUND_OVERLAY,
    backgroundBlur: 0,
  }), false);

  assert.equal(isPremiumAppearanceWrite({
    bubbleColor: "#e74c3c",
  }), true);
  assert.equal(isPremiumAppearanceWrite({
    backgroundType: "image",
  }), true);
  assert.equal(isPremiumAppearanceWrite({
    backgroundColor: "#112233",
  }), true);
  assert.equal(isPremiumAppearanceWrite({
    backgroundImage: "/api/media/channel/bg.jpg",
  }), true);
  assert.equal(isPremiumAppearanceWrite({
    backgroundOverlay: 24,
  }), true);
  assert.equal(isPremiumAppearanceWrite({
    backgroundBlur: 1,
  }), true);
});

test("admin route applies plus gates to ownership, freeze, live and customization paths", () => {
  assert.match(adminSource, /hasActivePlusEntitlement\(env, userId\)/);
  assert.match(adminSource, /const ownedChannelLimit = getOwnedChannelLimit\(hasPlus\)/);
  assert.match(adminSource, /case "freeze": \{[\s\S]*feature: "channel_freeze"/);
  assert.match(adminSource, /case "start-live": \{[\s\S]*feature: "live_session"/);
  assert.match(adminSource, /feature: "channel_customization"/);
  assert.match(adminSource, /owned_channel_limit: ownedChannelLimit/);
  assert.match(adminSource, /requires_plus: !hasPlus/);
});
