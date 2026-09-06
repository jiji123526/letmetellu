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
const initProxySource = readFileSync(
  new URL("../../src/app/api/init/route.ts", import.meta.url),
  "utf8",
);
const wsTokenProxySource = readFileSync(
  new URL("../../src/app/api/ws-token/route.ts", import.meta.url),
  "utf8",
);
const dataSource = readFileSync(
  new URL("../src/routes/data.ts", import.meta.url),
  "utf8",
);
const dataProxySource = readFileSync(
  new URL("../../src/app/api/data/route.ts", import.meta.url),
  "utf8",
);
const unifiedTimelineSource = readFileSync(
  new URL("../src/routes/unified-timeline.ts", import.meta.url),
  "utf8",
);
const unifiedTimelineProxySource = readFileSync(
  new URL("../../src/app/api/unified-timeline/route.ts", import.meta.url),
  "utf8",
);
const messagesSource = readFileSync(
  new URL("../src/routes/messages.ts", import.meta.url),
  "utf8",
);
const messagesProxySource = readFileSync(
  new URL("../../src/app/api/messages/route.ts", import.meta.url),
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
  assert.match(initSource, /channel_moderation\.petition_status AS moderation_petition_status/);
  assert.match(initSource, /AS reports_owner_id/);
  assert.doesNotMatch(initSource, /await getChannelModeration\(parentChannelId, env\)/);
  assert.doesNotMatch(initSource, /await getReportsChannelOwnerId\(env\)/);
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

test("channel entry proxies expose auth and Worker timing stages", () => {
  assert.match(initProxySource, /`auth;dur=\$\{authMs}`/);
  assert.match(initProxySource, /`worker;dur=\$\{workerMs}`/);
  assert.match(initProxySource, /`media-signing;dur=\$\{signingMs}`/);
  assert.match(initProxySource, /res\.headers\.get\("X-Yap-Worker-Timing"\)/);
  assert.match(initProxySource, /response\.headers\.set\("X-Yap-Worker-Timing", workerTiming\)/);
  assert.match(initSource, /withInitTiming\(response, \{/);
  assert.match(initSource, /bootstrap: bootstrapMs/);
  assert.match(wsTokenProxySource, /`auth;dur=\$\{authMs}`/);
  assert.match(wsTokenProxySource, /`worker;dur=\$\{workerMs}`/);
});

test("init reuses but never renews a valid channel read capability", () => {
  assert.match(initProxySource, /readChannelReadTokenCookie/);
  assert.match(initProxySource, /headers\["X-Channel-Read-Token"\] = channelReadToken/);
  assert.match(initSource, /authorizeChannelReadToken\(request, channelId, env\)/);
  assert.match(initSource, /const channel = channelReadAccess[\s\S]*channelReadAccess\.channel[\s\S]*: await readSharedChannel/);
  assert.match(initSource, /const channelReadTokenCandidate = !channelReadAccess/);
  assert.match(initSource, /channelReadTokenCandidate\.length <= 3_500/);
});

test("gallery and unified timeline reads expose diagnostic timing stages", () => {
  assert.match(dataSource, /case "gallery"[\s\S]*withDataTiming\(/);
  assert.match(dataSource, /"X-Yap-D1-Meta"/);
  assert.match(dataSource, /rowsRead: Number\(result\.meta\?\.rows_read/);
  assert.match(dataProxySource, /`auth;dur=\$\{authMs}`/);
  assert.match(dataProxySource, /response\.headers\.get\("X-Yap-D1-Meta"\)/);
  assert.match(unifiedTimelineSource, /withTimelineTiming\(/);
  assert.match(unifiedTimelineSource, /d1: Math\.round\(contextPage\.metrics\.d1DurationMs/);
  assert.match(unifiedTimelineProxySource, /response\.headers\.get\("X-Yap-Worker-Timing"\)/);
});

test("message sends expose proxy and mutation-stage timings", () => {
  assert.match(messagesSource, /function withMessageTiming/);
  assert.match(messagesSource, /channel: 0,[\s\S]*idempotency: 0,[\s\S]*persist: 0/);
  assert.match(messagesSource, /return withMessageTiming\(/);
  assert.match(messagesProxySource, /`auth;dur=\$\{authMs\}, worker;dur=\$\{workerMs\}/);
  assert.match(messagesProxySource, /res\.headers\.get\("X-Yap-Worker-Timing"\)/);
});
