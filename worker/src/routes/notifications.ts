import { consumeDurableRateLimit, hashRateLimitIdentifier } from "../lib/durable-rate-limit.ts";
import {
  isValidNotificationChannelId,
  MAX_ACTIVE_PUSH_SUBSCRIPTIONS,
  normalizePushUserAgentFamily,
  NOTIFICATION_BODY_LIMIT_BYTES,
  parseNotificationPreference,
  parsePushSubscription,
} from "../lib/notification-input.ts";
import { getTrustedUserId } from "../lib/trusted-identity.ts";
import type { Env } from "../types.ts";
import { authorizeRoomToken } from "./passcode.ts";

const PREFERENCE_MUTATION_LIMIT = 30;
const SUBSCRIPTION_MUTATION_LIMIT = 30;
const MUTATION_WINDOW_MS = 10 * 60 * 1000;

interface ChannelAccessRow {
  id: string;
  owner_uid: string;
  passcode: string | null;
  associated: number;
}

interface PushDeviceRow {
  id: string;
  user_agent_family: string | null;
  device_label: string | null;
  updated_at: string;
  last_success_at: string | null;
}

async function requireExistingUser(request: Request, env: Env): Promise<string | null> {
  const userId = getTrustedUserId(request, env);
  if (!userId) return null;
  const user = await env.DB.prepare("SELECT 1 FROM users WHERE id = ? LIMIT 1").bind(userId).first();
  return user ? userId : null;
}

async function readBoundedJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > NOTIFICATION_BODY_LIMIT_BYTES) {
    return { ok: false, response: Response.json({ error: "payload_too_large" }, { status: 413 }) };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > NOTIFICATION_BODY_LIMIT_BYTES) {
    return { ok: false, response: Response.json({ error: "payload_too_large" }, { status: 413 }) };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: Response.json({ error: "invalid_json" }, { status: 400 }) };
  }
}

async function consumeNotificationMutationLimit(
  env: Env,
  userId: string,
  scope: "notification-preference" | "push-subscription",
  limit: number,
): Promise<Response | null> {
  const result = await consumeDurableRateLimit({
    env,
    scope,
    subjectKey: await hashRateLimitIdentifier(scope, userId, env),
    limit,
    windowMs: MUTATION_WINDOW_MS,
  });
  return result.ok
    ? null
    : Response.json({ error: "rate_limited", reset_at: result.resetAt }, { status: 429 });
}

async function resolveChannelAccess(
  request: Request,
  env: Env,
  userId: string,
  channelId: string,
): Promise<{ ok: true; accessBinding: string | null } | { ok: false; response: Response }> {
  const channel = await env.DB.prepare(`
    SELECT c.id, c.owner_uid, c.passcode,
           EXISTS(
             SELECT 1
             FROM user_recent_channels recent
             WHERE recent.user_id = ? AND recent.channel_id = c.id
           ) AS associated
    FROM channels c
    WHERE c.id = ? AND c.id NOT LIKE '%_live'
    LIMIT 1
  `).bind(userId, channelId).first<ChannelAccessRow>();
  if (!channel) {
    return { ok: false, response: Response.json({ error: "channel_not_found" }, { status: 404 }) };
  }
  if (channel.owner_uid !== userId && !channel.associated) {
    return { ok: false, response: Response.json({ error: "channel_not_associated" }, { status: 403 }) };
  }
  if (!channel.passcode || channel.owner_uid === userId) {
    return { ok: true, accessBinding: null };
  }

  const roomToken = request.headers.get("X-Room-Token") || "";
  const verifiedRoom = roomToken
    ? await authorizeRoomToken(roomToken, channelId, channel.passcode, env)
    : null;
  if (!verifiedRoom) {
    return { ok: false, response: Response.json({ error: "channel_access_required" }, { status: 403 }) };
  }
  return { ok: true, accessBinding: verifiedRoom.passcode_binding };
}

async function listActiveDevices(env: Env, userId: string): Promise<PushDeviceRow[]> {
  const { results } = await env.DB.prepare(`
    SELECT id, user_agent_family, device_label, updated_at, last_success_at
    FROM push_subscriptions
    WHERE user_id = ? AND revoked_at IS NULL
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(userId, MAX_ACTIVE_PUSH_SUBSCRIPTIONS).all<PushDeviceRow>();
  return results;
}

function serializeDevices(devices: PushDeviceRow[]) {
  return devices.map((device) => ({
    id: device.id,
    browser: device.user_agent_family || "Other",
    label: device.device_label,
    updatedAt: device.updated_at,
    lastSuccessAt: device.last_success_at,
  }));
}

async function handlePreferences(request: Request, env: Env, userId: string): Promise<Response> {
  if (request.method === "GET") {
    const channelId = new URL(request.url).searchParams.get("channel") || "";
    if (!isValidNotificationChannelId(channelId)) {
      return Response.json({ error: "invalid_channel" }, { status: 400 });
    }
    const access = await resolveChannelAccess(request, env, userId, channelId);
    if (!access.ok) return access.response;

    const [preference, devices] = await Promise.all([
      env.DB.prepare(`
        SELECT mode, access_binding, updated_at
        FROM notification_preferences
        WHERE user_id = ? AND channel_id = ?
        LIMIT 1
      `).bind(userId, channelId).first<{
        mode: string;
        access_binding: string | null;
        updated_at: string;
      }>(),
      listActiveDevices(env, userId),
    ]);
    const hasCurrentAccessBinding = !preference
      || preference.access_binding === access.accessBinding;
    return Response.json({
      preference: {
        channelId,
        mode: preference?.mode === "important" && hasCurrentAccessBinding ? "important" : "off",
        updatedAt: preference?.updated_at || null,
        requiresReconfirmation: preference?.mode === "important" && !hasCurrentAccessBinding,
      },
      devices: serializeDevices(devices),
      activeDeviceCount: devices.length,
      maxActiveDevices: MAX_ACTIVE_PUSH_SUBSCRIPTIONS,
    });
  }

  if (request.method !== "PUT") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const bodyResult = await readBoundedJson(request);
  if (!bodyResult.ok) return bodyResult.response;
  const input = parseNotificationPreference(bodyResult.value);
  if (!input) return Response.json({ error: "invalid_preference" }, { status: 400 });

  const rateLimited = await consumeNotificationMutationLimit(
    env,
    userId,
    "notification-preference",
    PREFERENCE_MUTATION_LIMIT,
  );
  if (rateLimited) return rateLimited;

  if (input.mode === "off") {
    await env.DB.prepare(`
      DELETE FROM notification_preferences
      WHERE user_id = ? AND channel_id = ?
    `).bind(userId, input.channelId).run();
    return Response.json({ ok: true, preference: { channelId: input.channelId, mode: "off" } });
  }

  const access = await resolveChannelAccess(request, env, userId, input.channelId);
  if (!access.ok) return access.response;
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO notification_preferences (
      user_id, channel_id, mode, access_binding, created_at, updated_at
    ) VALUES (?, ?, 'important', ?, ?, ?)
    ON CONFLICT(user_id, channel_id) DO UPDATE SET
      mode = 'important',
      access_binding = excluded.access_binding,
      updated_at = excluded.updated_at
  `).bind(userId, input.channelId, access.accessBinding, now, now).run();
  return Response.json({
    ok: true,
    preference: { channelId: input.channelId, mode: "important", updatedAt: now },
  });
}

async function handleSubscriptionRegistration(request: Request, env: Env, userId: string): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const bodyResult = await readBoundedJson(request);
  if (!bodyResult.ok) return bodyResult.response;
  const input = parsePushSubscription(bodyResult.value);
  if (!input) return Response.json({ error: "invalid_subscription" }, { status: 400 });

  const rateLimited = await consumeNotificationMutationLimit(
    env,
    userId,
    "push-subscription",
    SUBSCRIPTION_MUTATION_LIMIT,
  );
  if (rateLimited) return rateLimited;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const family = normalizePushUserAgentFamily(request.headers.get("X-Client-User-Agent"));
  const result = await env.DB.prepare(`
    INSERT INTO push_subscriptions (
      id, user_id, endpoint, p256dh, auth, expiration_time,
      user_agent_family, device_label, created_at, updated_at,
      failure_count, revoked_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL
    WHERE (
      SELECT COUNT(*)
      FROM push_subscriptions
      WHERE user_id = ? AND revoked_at IS NULL AND endpoint != ?
    ) < ?
    ON CONFLICT(endpoint) DO UPDATE SET
      id = excluded.id,
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      expiration_time = excluded.expiration_time,
      user_agent_family = excluded.user_agent_family,
      device_label = excluded.device_label,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      last_success_at = NULL,
      last_failure_at = NULL,
      failure_count = 0,
      revoked_at = NULL
  `).bind(
    id,
    userId,
    input.endpoint,
    input.p256dh,
    input.auth,
    input.expirationTime,
    family,
    input.deviceLabel,
    now,
    now,
    userId,
    input.endpoint,
    MAX_ACTIVE_PUSH_SUBSCRIPTIONS,
  ).run();
  if (!result.meta.changes) {
    return Response.json({ error: "device_limit_reached", maxActiveDevices: MAX_ACTIVE_PUSH_SUBSCRIPTIONS }, { status: 409 });
  }

  const devices = await listActiveDevices(env, userId);
  return Response.json({
    ok: true,
    subscriptionId: id,
    devices: serializeDevices(devices),
    activeDeviceCount: devices.length,
    maxActiveDevices: MAX_ACTIVE_PUSH_SUBSCRIPTIONS,
  });
}

async function handleSubscriptionRevocation(
  request: Request,
  env: Env,
  userId: string,
  subscriptionId: string,
): Promise<Response> {
  if (request.method !== "DELETE") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscriptionId)) {
    return Response.json({ error: "invalid_subscription_id" }, { status: 400 });
  }
  const rateLimited = await consumeNotificationMutationLimit(
    env,
    userId,
    "push-subscription",
    SUBSCRIPTION_MUTATION_LIMIT,
  );
  if (rateLimited) return rateLimited;

  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE push_subscriptions
    SET revoked_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL
  `).bind(now, now, subscriptionId, userId).run();
  return Response.json({ ok: true });
}

export async function handleNotifications(request: Request, env: Env): Promise<Response> {
  const userId = await requireExistingUser(request, env);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/notifications/preferences") {
    return handlePreferences(request, env, userId);
  }
  if (pathname === "/api/notifications/subscriptions") {
    return handleSubscriptionRegistration(request, env, userId);
  }
  const prefix = "/api/notifications/subscriptions/";
  if (pathname.startsWith(prefix)) {
    return handleSubscriptionRevocation(
      request,
      env,
      userId,
      decodeURIComponent(pathname.slice(prefix.length)),
    );
  }
  return Response.json({ error: "not_found" }, { status: 404 });
}
