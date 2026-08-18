import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const initSource = readFileSync(
  new URL("../src/routes/init.ts", import.meta.url),
  "utf8",
);
const userSource = readFileSync(
  new URL("../src/routes/user.ts", import.meta.url),
  "utf8",
);
const chatViewSource = readFileSync(
  new URL("../../src/components/chat/ChatView.tsx", import.meta.url),
  "utf8",
);
const popupSource = readFileSync(
  new URL("../../src/components/chat/OwnerChannelsPopup.tsx", import.meta.url),
  "utf8",
);
const apiRouteSource = readFileSync(
  new URL("../../src/app/api/user/route.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL("../migrations/0042_owner_channel_profile_lookup.sql", import.meta.url),
  "utf8",
);

test("init uses a two-row indexed owner-channel probe", () => {
  assert.match(initSource, /const ownerChannelCountIndex = statements\.length/);
  assert.match(initSource, /show_on_profile = 1[\s\S]*LIMIT 2/);
  assert.match(initSource, /safeChannel\.owner_channel_count = ownerChannelCount/);
  assert.match(
    migrationSource,
    /channels_owner_profile_created_id_idx\s+ON channels\(owner_uid, show_on_profile, created_at, id\)/,
  );
});

test("chat startup uses init metadata instead of fetching the owner list", () => {
  assert.match(
    chatViewSource,
    /channel\?\.show_on_profile === 1[\s\S]*channel\.owner_channel_count \|\| 0/,
  );
  assert.doesNotMatch(chatViewSource, /fetchOwnerChannels/);
});

test("eligible owner profiles preload their bounded list and reuse a short client cache", () => {
  assert.match(chatViewSource, /ownerChannelCount < 2/);
  assert.match(chatViewSource, /requestIdleCallback/);
  assert.match(chatViewSource, /import\("\.\/OwnerChannelsPopup"\)/);
  assert.match(chatViewSource, /preloadOwnerChannels\(channel\?\.owner_uid, channelId\)/);
  assert.match(popupSource, /getCachedOwnerChannels\(ownerUid, currentChannelId\)/);
});

test("the full owner list loads by owner metadata and respects the five-channel limit", () => {
  assert.match(apiRouteSource, /owner=\$\{encodeURIComponent\(ownerUid\)\}/);
  assert.match(popupSource, /fetchOwnerChannels\(ownerUid, currentChannelId\)/);
  assert.match(userSource, /let profileOwnerUid = ownerUid \|\| ""/);
  assert.match(userSource, /ORDER BY created_at ASC, id ASC\s+LIMIT 5/);
  assert.doesNotMatch(userSource, /show_on_profile = 1[\s\S]*LIMIT 50/);
});
