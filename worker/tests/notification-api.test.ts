import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_ACTIVE_PUSH_SUBSCRIPTIONS,
  normalizePushUserAgentFamily,
  parseNotificationPreference,
  parsePushSubscription,
} from "../src/lib/notification-input.ts";

const route = readFileSync(new URL("../src/routes/notifications.ts", import.meta.url), "utf8");
const workerIndex = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const accessBindingMigration = readFileSync(
  new URL("../migrations/0056_notification_access_binding.sql", import.meta.url),
  "utf8",
);
const preferenceProxy = readFileSync(
  new URL("../../src/app/api/notifications/preferences/route.ts", import.meta.url),
  "utf8",
);
const subscriptionProxy = readFileSync(
  new URL("../../src/app/api/notifications/subscriptions/route.ts", import.meta.url),
  "utf8",
);
const revokeProxy = readFileSync(
  new URL("../../src/app/api/notifications/subscriptions/[id]/route.ts", import.meta.url),
  "utf8",
);
const vapidKeyProxy = readFileSync(
  new URL("../../src/app/api/notifications/vapid-key/route.ts", import.meta.url),
  "utf8",
);
const pushClient = readFileSync(
  new URL("../../src/lib/web-push-client.ts", import.meta.url),
  "utf8",
);
const serviceWorker = readFileSync(
  new URL("../../public/push-sw.js", import.meta.url),
  "utf8",
);
const testProxy = readFileSync(
  new URL("../../src/app/api/notifications/test/route.ts", import.meta.url),
  "utf8",
);
const delivery = readFileSync(
  new URL("../src/lib/notification-delivery.ts", import.meta.url),
  "utf8",
);
const outboxMigration = readFileSync(
  new URL("../migrations/0057_notification_delivery_outbox.sql", import.meta.url),
  "utf8",
);
const proxyHelper = readFileSync(
  new URL("../../src/lib/notification-proxy.ts", import.meta.url),
  "utf8",
);

const validSubscription = {
  endpoint: "https://push.example.test/subscription/abc",
  keys: {
    p256dh: "A".repeat(87),
    auth: "b".repeat(22),
  },
  expirationTime: null,
  device_label: "  My phone  ",
};

test("the first API rollout exposes only off and important modes", () => {
  assert.deepEqual(parseNotificationPreference({ channel_id: "my-room", mode: "important" }), {
    channelId: "my-room",
    mode: "important",
  });
  assert.deepEqual(parseNotificationPreference({ channel_id: "my-room", mode: "off" }), {
    channelId: "my-room",
    mode: "off",
  });
  assert.equal(parseNotificationPreference({ channel_id: "my-room", mode: "all" }), null);
  assert.equal(parseNotificationPreference({ channel_id: "../room", mode: "important" }), null);
});

test("push subscription input is bounded and requires HTTPS browser keys", () => {
  assert.deepEqual(parsePushSubscription(validSubscription), {
    endpoint: validSubscription.endpoint,
    p256dh: validSubscription.keys.p256dh,
    auth: validSubscription.keys.auth,
    expirationTime: null,
    deviceLabel: "My phone",
  });
  assert.equal(parsePushSubscription({ ...validSubscription, endpoint: "http://push.example.test/a" }), null);
  assert.equal(parsePushSubscription({ ...validSubscription, keys: { p256dh: "short", auth: "short" } }), null);
  assert.equal(MAX_ACTIVE_PUSH_SUBSCRIPTIONS, 5);
});

test("only a coarse browser family is retained", () => {
  assert.equal(normalizePushUserAgentFamily("Mozilla Chrome/120 Safari/537"), "Chrome");
  assert.equal(normalizePushUserAgentFamily("Mozilla Edg/120 Chrome/120"), "Edge");
  assert.equal(normalizePushUserAgentFamily("Mozilla Version/17 Safari/605"), "Safari");
  assert.equal(normalizePushUserAgentFamily("custom-client"), "Other");
});

test("notification APIs require trusted existing accounts and current channel access", () => {
  assert.match(accessBindingMigration, /ALTER TABLE notification_preferences ADD COLUMN access_binding TEXT/);
  assert.match(route, /getTrustedUserId\(request, env\)/);
  assert.match(route, /SELECT 1 FROM users WHERE id = \? LIMIT 1/);
  assert.match(route, /FROM user_recent_channels recent[\s\S]*recent\.user_id = \? AND recent\.channel_id = c\.id/);
  assert.match(route, /channel\.owner_uid !== userId && !channel\.associated/);
  assert.match(route, /authorizeRoomToken\(roomToken, channelId, channel\.passcode, env\)/);
  assert.match(route, /access_binding = excluded\.access_binding/);
});

test("turning notifications off remains possible after channel access is lost", () => {
  const offBranch = route.slice(
    route.indexOf('if (input.mode === "off")'),
    route.indexOf("const access = await resolveChannelAccess", route.indexOf('if (input.mode === "off")')),
  );
  assert.match(offBranch, /DELETE FROM notification_preferences/);
  assert.doesNotMatch(offBranch, /resolveChannelAccess/);
});

test("a passcode change is represented as off until the user opts in again", () => {
  assert.match(route, /SELECT mode, access_binding, updated_at/);
  assert.match(route, /preference\.access_binding === access\.accessBinding/);
  assert.match(route, /requiresReconfirmation: preference\?\.mode === "important" && !hasCurrentAccessBinding/);
});

test("device registration is capped atomically and responses omit endpoint secrets", () => {
  assert.match(route, /COUNT\(\*\)[\s\S]*revoked_at IS NULL AND endpoint != \?[\s\S]*< \?/);
  assert.match(route, /ON CONFLICT\(endpoint\) DO UPDATE SET[\s\S]*user_id = excluded\.user_id/);
  assert.match(route, /device_limit_reached/);
  const deviceQuery = route.slice(route.indexOf("async function listActiveDevices"), route.indexOf("function serializeDevices"));
  assert.doesNotMatch(deviceQuery, /endpoint|p256dh|auth/);
  const serialization = route.slice(route.indexOf("function serializeDevices"), route.indexOf("async function handlePreferences"));
  assert.doesNotMatch(serialization, /endpoint|p256dh|auth/);
});

test("subscription revocation is idempotent and ownership-scoped", () => {
  assert.match(route, /WHERE id = \? AND user_id = \? AND revoked_at IS NULL/);
  assert.match(route, /return Response\.json\(\{ ok: true \}\)/);
});

test("mutations are bounded, rate limited and routed through authenticated same-origin proxies", () => {
  assert.match(route, /NOTIFICATION_BODY_LIMIT_BYTES/);
  assert.match(route, /consumeDurableRateLimit/);
  assert.match(workerIndex, /url\.pathname\.startsWith\("\/api\/notifications"\)/);
  assert.match(preferenceProxy, /const session = await auth\(\)/);
  assert.match(subscriptionProxy, /const session = await auth\(\)/);
  assert.match(revokeProxy, /const session = await auth\(\)/);
  assert.match(preferenceProxy, /isSameOriginNotificationMutation\(request\)/);
  assert.match(subscriptionProxy, /isSameOriginNotificationMutation\(request\)/);
  assert.match(revokeProxy, /isSameOriginNotificationMutation\(request\)/);
  assert.match(proxyHelper, /new URL\(origin\)\.origin === new URL\(request\.url\)\.origin/);
  assert.match(proxyHelper, /readRoomTokenCookie/);
});

test("VAPID public key access is authenticated and private-cache scoped", () => {
  assert.match(route, /pathname === "\/api\/notifications\/vapid-key"/);
  assert.match(route, /VAPID_PUBLIC_KEY_PATTERN\.test\(env\.VAPID_PUBLIC_KEY/);
  assert.match(route, /"Cache-Control": "private, max-age=300"/);
  assert.match(vapidKeyProxy, /const session = await auth\(\)/);
  assert.match(vapidKeyProxy, /cache: "no-store"/);
});

test("browser subscription requires an explicit caller and stores only serialized Push API data", () => {
  assert.match(pushClient, /Notification\.requestPermission\(\)/);
  assert.match(pushClient, /navigator\.serviceWorker\.register\("\/push-sw\.js"/);
  assert.match(pushClient, /applicationServerKey: base64UrlToUint8Array\(publicKey\)/);
  assert.match(pushClient, /fetch\("\/api\/notifications\/subscriptions"/);
  assert.doesNotMatch(pushClient, /addEventListener\(["']load/);
});

test("push clicks accept only same-origin channel paths", () => {
  assert.match(serviceWorker, /target\.origin !== self\.location\.origin/);
  assert.match(serviceWorker, /!target\.pathname\.startsWith\("\/ch\/"\)/);
  assert.match(serviceWorker, /includeUncontrolled: true/);
});

test("self-test delivery is owner scoped, strongly rate limited and queued", () => {
  assert.match(route, /"push-self-test"/);
  assert.match(route, /SELF_TEST_LIMIT = 3/);
  assert.match(route, /SELF_TEST_WINDOW_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(route, /WHERE id = \? AND user_id = \? AND revoked_at IS NULL/);
  assert.match(route, /INSERT INTO notification_outbox/);
  assert.match(route, /ctx\.waitUntil\(processNotificationOutbox\(env, 1, id\)\)/);
  assert.match(testProxy, /isSameOriginNotificationMutation\(request\)/);
  assert.match(testProxy, /const session = await auth\(\)/);
});

test("outbox delivery uses leases, bounded retries and permanent endpoint cleanup", () => {
  assert.match(outboxMigration, /event_key TEXT NOT NULL UNIQUE/);
  assert.match(outboxMigration, /ON DELETE CASCADE ON UPDATE CASCADE/);
  assert.match(outboxMigration, /notification_outbox_ready_idx/);
  assert.match(delivery, /DELIVERY_BATCH_SIZE = 10/);
  assert.match(delivery, /DELIVERY_LEASE_MS = 2 \* 60 \* 1000/);
  assert.match(delivery, /MAX_DELIVERY_ATTEMPTS = 4/);
  assert.match(delivery, /preferredId \? env\.DB\.prepare/);
  assert.match(delivery, /status === 404 \|\| status === 410/);
  assert.match(delivery, /SET revoked_at = \?/);
  assert.match(delivery, /status === 0 \|\| status === 408 \|\| status === 429 \|\| status >= 500/);
  assert.doesNotMatch(delivery, /console\.(?:log|warn|error).*endpoint/);
});
