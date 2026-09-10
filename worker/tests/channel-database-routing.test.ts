import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const channelStateSource = readFileSync(
  new URL("../src/routes/channel-state.ts", import.meta.url),
  "utf8",
);
const socketAuthSource = readFileSync(
  new URL("../src/routes/socket-auth.ts", import.meta.url),
  "utf8",
);
const unifiedTimelineSource = readFileSync(
  new URL("../src/routes/unified-timeline.ts", import.meta.url),
  "utf8",
);
const dataSource = readFileSync(
  new URL("../src/routes/data.ts", import.meta.url),
  "utf8",
);
const dmSource = readFileSync(
  new URL("../src/routes/dm.ts", import.meta.url),
  "utf8",
);
const initSource = readFileSync(
  new URL("../src/routes/init.ts", import.meta.url),
  "utf8",
);

test("channel state reads through the channel database boundary", () => {
  assert.match(
    channelStateSource,
    /resolveChannelDatabase\(env, parentChannelId\)/,
  );
  assert.match(
    channelStateSource,
    /resolvedDatabase\.database\.prepare\(`\s*SELECT owner_uid, is_frozen/,
  );
  assert.match(
    channelStateSource,
    /getChannelModeration\(parentChannelId, channelEnv\)/,
  );
  assert.doesNotMatch(channelStateSource, /env\.DB\.prepare/);
});

test("socket authorization separates channel and control database reads", () => {
  assert.match(
    socketAuthSource,
    /resolveChannelDatabase\(env, parentChannelId\)/,
  );
  assert.match(
    socketAuthSource,
    /resolvedDatabase\.database\s*\.prepare\("SELECT id, owner_uid, passcode FROM channels/,
  );
  assert.match(
    socketAuthSource,
    /isPlatformAdmin\(trustedUserId, env\)/,
  );
  assert.doesNotMatch(socketAuthSource, /env\.DB\.prepare/);
});

test("unified timeline separates channel and control database reads", () => {
  assert.match(
    unifiedTimelineSource,
    /resolveChannelDatabase\(env, parentChannelId\)/,
  );
  assert.match(
    unifiedTimelineSource,
    /createD1ReadSessionEnv\(\s*env,\s*channelReadAccess \? "first-unconstrained" : "first-primary",\s*resolvedDatabase\.database,\s*\)/,
  );
  assert.match(
    unifiedTimelineSource,
    /isPlatformAdmin\(trustedUserId, env\)/,
  );
  assert.match(
    unifiedTimelineSource,
    /getUserLocale\(trustedUserId, env\)/,
  );
  assert.doesNotMatch(
    unifiedTimelineSource,
    /(?:isPlatformAdmin|getUserLocale)\(trustedUserId, readEnv\)/,
  );
});

test("data collections separate channel and control database reads", () => {
  assert.match(
    dataSource,
    /resolveChannelDatabase\(env, parentChannelId\)/,
  );
  assert.match(
    dataSource,
    /createD1ReadSessionEnv\(\s*env,\s*channelReadAccess \? "first-unconstrained" : "first-primary",\s*resolvedDatabase\.database,\s*\)/,
  );
  assert.match(dataSource, /isPlatformAdmin\(trustedUserId, env\)/);
  assert.match(dataSource, /getUserLocale\(trustedUserId, env\)/);
  assert.doesNotMatch(
    dataSource,
    /(?:isPlatformAdmin|getUserLocale)\(trustedUserId, readEnv\)/,
  );
  assert.match(
    dataSource,
    /recordOperationalEvent\(\{\s*env,/,
  );
});

test("private DM GET separates channel and control database reads", () => {
  const getStart = dmSource.indexOf('if (request.method === "GET")');
  const putStart = dmSource.indexOf('if (request.method === "PUT")');
  assert.ok(getStart >= 0 && putStart > getStart);
  const getSource = dmSource.slice(getStart, putStart);

  assert.match(getSource, /resolveChannelDatabase\(env, parentChannelId\)/);
  assert.match(
    getSource,
    /createD1ReadSessionEnv\(\s*env,\s*"first-primary",\s*resolvedDatabase\.database,\s*\)/,
  );
  assert.match(
    getSource,
    /getChannelPasscodeInfo\(parentChannelId, readEnv\)/,
  );
  assert.match(getSource, /readDmThreads\(\s*readEnv,/);
  assert.match(getSource, /getReportsChannelOwnerId\(env\)/);
});

test("init separates channel and control database reads", () => {
  assert.match(initSource, /resolveChannelDatabase\(env, parentChannelId\)/);
  assert.match(
    initSource,
    /readSharedChannel\(\s*readEnv,\s*env,\s*parentChannelId,/,
  );
  assert.match(
    initSource,
    /getChannelDatabaseCacheScope\(resolvedDatabase\)/,
  );
  assert.match(
    initSource,
    /createD1ReadSessionEnv\(\s*env,\s*readConstraint,\s*resolvedDatabase\.database,\s*\)/,
  );
  assert.match(
    initSource,
    /const usesControlDatabase = resolvedDatabase\.database === env\.DB/,
  );
  assert.match(
    initSource,
    /LEFT JOIN channel_moderation ON channel_moderation\.channel_id = channels\.id[\s\S]*WHERE channels\.id = \?/,
  );
  assert.match(
    initSource,
    /WITH target AS \([\s\S]*AS projection_owner_uid/,
  );
  assert.match(initSource, /mergeInitChannelProjection\(channel, projection\)/);
  assert.match(
    initSource,
    /const channelReadAccess = \([\s\S]*usesControlDatabase[\s\S]*authorizedChannelRead\?\.version === 1/,
  );
  assert.match(
    initSource,
    /if \(reportsChannel && !usesControlDatabase\) \{[\s\S]*reports_channel_shard_not_ready[\s\S]*status: 503/,
  );
  assert.match(
    initSource,
    /endLiveSession\(\s*channelEnv,/,
  );
  assert.match(initSource, /isPlatformAdmin\(trustedUserId, env\)/);
  assert.doesNotMatch(initSource, /channel_init_shard_not_ready/);
});
