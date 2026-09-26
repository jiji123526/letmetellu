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
const messagesSource = readFileSync(
  new URL("../src/routes/messages.ts", import.meta.url),
  "utf8",
);
const notificationEventsSource = readFileSync(
  new URL("../src/lib/notification-events.ts", import.meta.url),
  "utf8",
);
const uploadSource = readFileSync(
  new URL("../src/routes/upload.ts", import.meta.url),
  "utf8",
);
const passcodeSource = readFileSync(
  new URL("../src/routes/passcode.ts", import.meta.url),
  "utf8",
);
const notificationsSource = readFileSync(
  new URL("../src/routes/notifications.ts", import.meta.url),
  "utf8",
);
const adminSource = readFileSync(
  new URL("../src/routes/admin.ts", import.meta.url),
  "utf8",
);
const chatRoomSource = readFileSync(
  new URL("../src/realtime/chat-room.ts", import.meta.url),
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
    /authorizeChannelReadToken\(request, channelId, env, resolvedDatabase\)/,
  );
  assert.match(
    unifiedTimelineSource,
    /placement: resolvedDatabase,/,
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
  assert.match(
    dataSource,
    /authorizeChannelReadToken\(request, channelId, env, resolvedDatabase\)/,
  );
  assert.match(dataSource, /placement: resolvedDatabase,/);
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
  assert.match(getSource, /isEntryDeniedActor\(\{\s*env: readEnv,/);
  assert.match(getSource, /getReportsChannelOwnerId\(env\)/);
});

test("private DM mutations resolve and constrain the channel database", () => {
  assert.equal(
    dmSource.match(/resolveChannelDatabase\(env, parentChannelId\)/g)?.length,
    4,
  );
  assert.doesNotMatch(dmSource, /\benv\.DB\.(?:prepare|batch)/);
  assert.match(
    dmSource,
    /const channelId = typeof body\.channel_id === "string" \? body\.channel_id : "";/,
  );
  assert.match(
    dmSource,
    /WHERE dm\.id = \? AND dm\.channel_id = \? AND dm\.pending_delete_at IS NULL/,
  );
  assert.match(dmSource, /queueChannelNotification\(\{[\s\S]*?env,[\s\S]*?channelEnv,/);
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
    /authorizeChannelReadToken\([\s\S]*resolvedDatabase,[\s\S]*\)/,
  );
  assert.match(
    initSource,
    /isChannelReadSnapshot\(authorizedChannelRead\)/,
  );
  assert.match(
    initSource,
    /placement: resolvedDatabase,/,
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

test("message mutations use the resolved channel database", () => {
  assert.equal(
    messagesSource.match(/resolveChannelDatabase\(env, parentChannelId\)/g)?.length,
    4,
  );
  assert.doesNotMatch(messagesSource, /\benv\.DB\.(?:prepare|batch)/);
  assert.match(
    messagesSource,
    /completePersistedMessageDelivery\(\{[\s\S]*?controlEnv: env,[\s\S]*?channelEnv,/,
  );
  assert.match(
    messagesSource,
    /queueChannelNotification\(\{[\s\S]*?env,[\s\S]*?channelEnv,/,
  );
});

test("notification fanout separates channel metadata from control state", () => {
  assert.match(
    notificationEventsSource,
    /const channelEnv = input\.channelEnv \|\| input\.env;/,
  );
  assert.match(
    notificationEventsSource,
    /channelEnv\.DB\.prepare\(`\s*SELECT id, name, owner_uid, passcode/,
  );
  assert.match(
    notificationEventsSource,
    /input\.env\.DB\.prepare\(`\s*SELECT\s+pref\.user_id,/,
  );
  assert.match(notificationEventsSource, /input\.env\.DB\.batch\(statements\)/);
});

test("uploads and standard media keys resolve channel placement", () => {
  const uploadStart = uploadSource.indexOf("export async function handleUpload");
  const mediaStart = uploadSource.indexOf("export async function handleMediaServe");
  assert.ok(uploadStart >= 0 && mediaStart > uploadStart);
  const mutationSource = uploadSource.slice(uploadStart, mediaStart);
  const mediaSource = uploadSource.slice(mediaStart);

  assert.match(mutationSource, /resolveChannelDatabase\(env, parentChannelId\)/);
  assert.match(mutationSource, /ensureActiveLiveSession\(channelEnv, parentChannelId\)/);
  assert.match(mutationSource, /enforceUploadQuota\(\{\s*env: channelEnv,/);
  assert.match(mutationSource, /createUploadTicket\(\{\s*env: channelEnv,/);
  assert.doesNotMatch(mutationSource, /\benv\.DB\.(?:prepare|batch)/);

  assert.match(mediaSource, /readChannelIdFromMediaKey\(decodedKey\)/);
  assert.match(mediaSource, /resolveChannelDatabase\(env, parentChannelId\)/);
  assert.match(mediaSource, /mediaEnv\.DB\.prepare\(\s*"SELECT channel_id, purpose, status, expires_at FROM upload_tickets/);
  assert.match(mediaSource, /getChannelPasscodeInfo\(parentChannelId, mediaEnv\)/);
  assert.match(mediaSource, /Legacy or malformed keys still fall back/);
});

test("passcode verification and legacy upgrades use channel placement", () => {
  const handlerStart = passcodeSource.indexOf("export async function handleVerifyPasscode");
  const verifyTokenStart = passcodeSource.indexOf("export async function verifyRoomToken");
  assert.ok(handlerStart >= 0 && verifyTokenStart > handlerStart);
  const handlerSource = passcodeSource.slice(handlerStart, verifyTokenStart);

  assert.match(handlerSource, /resolveChannelDatabase\(env, channel_id\)/);
  assert.match(handlerSource, /channelEnv\.DB\.prepare\("SELECT passcode FROM channels/);
  assert.match(handlerSource, /channelEnv\.DB\.prepare\(\s*"UPDATE channels SET passcode/);
  assert.doesNotMatch(handlerSource, /\benv\.DB\.(?:prepare|batch)/);
});

test("notification access separates channel authority from account association", () => {
  const accessStart = notificationsSource.indexOf("async function resolveChannelAccess");
  const devicesStart = notificationsSource.indexOf("async function listActiveDevices");
  assert.ok(accessStart >= 0 && devicesStart > accessStart);
  const accessSource = notificationsSource.slice(accessStart, devicesStart);

  assert.match(accessSource, /resolveChannelDatabase\(env, channelId\)/);
  assert.match(accessSource, /resolvedDatabase\.database\.prepare\(`\s*SELECT id, owner_uid, passcode/);
  assert.match(accessSource, /env\.DB\.prepare\(`\s*SELECT 1\s*FROM user_recent_channels/);
});

test("existing-channel admin mutations use the resolved channel database", () => {
  assert.match(adminSource, /resolveChannelDatabase\(env, channel_id\)/);
  assert.match(
    adminSource,
    /channelEnv = withDatabase\(env, resolvedDatabase\.database\)/,
  );
  assert.match(
    adminSource,
    /channelEnv\.DB\.prepare\("SELECT owner_uid FROM channels WHERE id = \?"\)/,
  );
  assert.match(adminSource, /getChannelModeration\(channel_id, channelEnv\)/);
  assert.match(adminSource, /stageMessageDeletion\(channelEnv,/);
  assert.match(adminSource, /stageDmDeletion\(channelEnv,/);
  assert.match(adminSource, /stageDmReplyDeletion\(channelEnv,/);
  assert.match(adminSource, /undoPendingDeletion\(channelEnv,/);
  assert.match(adminSource, /endLiveSession\(channelEnv,/);
  assert.match(
    adminSource,
    /const ownerProfile = await env\.DB\.prepare\("SELECT name FROM users WHERE id = \?"\)/,
  );
  assert.match(adminSource, /deleteChannel\(channel_id, env\)/);
});

test("realtime access policy and live joins use channel placement", () => {
  assert.equal(
    chatRoomSource.match(/resolveChannelDatabase\(this\.env, channelId\)/g)?.length,
    1,
  );
  assert.match(
    chatRoomSource,
    /resolvedDatabase\.database\.prepare\(\s*"SELECT passcode FROM channels WHERE id = \?"/,
  );
  assert.match(
    chatRoomSource,
    /resolveChannelDatabase\(this\.env, connection\.channelId\)/,
  );
  assert.match(
    chatRoomSource,
    /readLiveSessionState\(channelEnv, connection\.channelId\)/,
  );
  assert.doesNotMatch(chatRoomSource, /this\.env\.DB\.prepare/);
});
