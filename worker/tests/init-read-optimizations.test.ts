import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const initSource = readFileSync(
  new URL("../src/routes/init.ts", import.meta.url),
  "utf8",
);
const indexSource = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);
const channelStateSource = readFileSync(
  new URL("../src/routes/channel-state.ts", import.meta.url),
  "utf8",
);
const apiChatSource = readFileSync(
  new URL("../../src/lib/api-chat.ts", import.meta.url),
  "utf8",
);
const bootstrapSource = readFileSync(
  new URL("../../src/components/chat/useChatChannelBootstrap.ts", import.meta.url),
  "utf8",
);

test("init only reads live-channel frozen state when the live row is relevant", () => {
  assert.match(initSource, /function readSharedInitConfig/);
  assert.match(initSource, /if \(isLiveChannel\) \{\s*statements\.push\(/);
  assert.match(initSource, /liveRow: isLiveChannel/);
  assert.match(initSource, /LEFT JOIN channel_moderation ON channel_moderation\.channel_id = channels\.id/);
  assert.match(initSource, /WHERE id IN \(\?, \?, \?, \?, \?, \?\)/);
  assert.doesNotMatch(initSource, /SELECT status FROM channel_moderation WHERE channel_id = \? LIMIT 1/);
});

test("init shares only public in-flight reads and keeps viewer state separate", () => {
  assert.match(initSource, /const sharedChannelRequests = new Map/);
  assert.match(initSource, /const sharedConfigRequests = new Map/);
  assert.match(initSource, /readSharedChannel\(env, parentChannelId, reportsChannelId\)/);
  assert.match(initSource, /readSharedInitConfig\(env, channelId, parentChannelId, isLiveChannel\)/);
  assert.match(initSource, /readDmThreads\([\s\S]*anonymousUid: anonymousIdentity\.uid/);
  assert.match(initSource, /viewerBlockedIndex = statements\.length/);
  assert.doesNotMatch(initSource, /shared(?:Channel|Config)Requests\.set\([^\n]*anonymousIdentity/);
});

test("owner moderation refresh uses a dedicated narrow channel-state route", () => {
  const refreshOwnerModerationStart = bootstrapSource.indexOf("const refreshOwnerModeration = useCallback");
  const refreshOwnerModerationEnd = bootstrapSource.indexOf("useEffect(() => {", refreshOwnerModerationStart);
  const refreshOwnerModerationSource = bootstrapSource.slice(
    refreshOwnerModerationStart,
    refreshOwnerModerationEnd,
  );

  assert.match(indexSource, /url\.pathname\.startsWith\("\/api\/channel-state"\)/);
  assert.match(channelStateSource, /parentChannel\.owner_uid !== userId/);
  assert.match(channelStateSource, /SELECT owner_uid, is_frozen/);
  assert.match(channelStateSource, /ownerModeration: \{\s*status: moderation\.status,\s*petitionStatus: moderation\.petition_status,/);
  assert.match(apiChatSource, /fetch\(`\/api\/channel-state\?channel=/);
  assert.match(refreshOwnerModerationSource, /fetchOwnerModerationState\(fetchChannel\)/);
  assert.doesNotMatch(refreshOwnerModerationSource, /fetchInit\(fetchChannel\)/);
});

test("client session hydration does not restart the channel bootstrap", () => {
  const bootstrapEffectStart = bootstrapSource.indexOf("const shouldResumeLive =");
  const bootstrapEffectEnd = bootstrapSource.indexOf("const showPasscodeGate", bootstrapEffectStart);
  const bootstrapEffectSource = bootstrapSource.slice(bootstrapEffectStart, bootstrapEffectEnd);

  assert.match(bootstrapEffectSource, /applyInitDataRef\.current\(data\)/);
  assert.match(bootstrapEffectSource, /applyInitDataRef\.current\(normalData\)/);
  assert.doesNotMatch(bootstrapEffectSource, /\[\s*applyInitData,/);
});
