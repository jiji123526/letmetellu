import { Env } from "../types";
import { getChannelDatabaseMaintenanceScopes, withDatabase } from "../lib/database-access";

const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const RECENT_CHANNEL_LIMIT = 100;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function authorize(request: Request, env: Env) {
  const internalToken = request.headers.get("X-Internal-Token");
  const userId = request.headers.get("X-User-Id");
  const userEmail = normalizeEmail(request.headers.get("X-User-Email") || "");
  if (internalToken !== env.INTERNAL_SECRET || (!userId && !userEmail)) return null;
  return {
    userId: userId || "",
    userEmail,
    canonicalUserId: request.headers.get("X-Canonical-User-Id") === "1",
  };
}

async function resolveRecentChannelUser(
  env: Env,
  identity: { userId: string; userEmail: string; canonicalUserId: boolean },
) {
  if (identity.canonicalUserId && identity.userId) {
    return identity.userId;
  }

  const userById = identity.userId
    ? await env.DB.prepare("SELECT id, email FROM users WHERE id = ?")
      .bind(identity.userId).first<{ id: string; email: string }>()
    : null;
  if (userById && (!identity.userEmail || normalizeEmail(userById.email) === identity.userEmail)) {
    return userById.id;
  }

  const userByEmail = identity.userEmail
    ? await env.DB.prepare("SELECT id, email FROM users WHERE lower(email) = ?")
      .bind(identity.userEmail).first<{ id: string; email: string }>()
    : null;
  const user = userByEmail || userById;

  if (!user) {
    return identity.userId || null;
  }

  if (identity.userId && identity.userId !== user.id) {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO user_recent_channels (user_id, channel_id, last_visited_at, pinned, bubble_color)
        SELECT ?, channel_id, last_visited_at, pinned, bubble_color
        FROM user_recent_channels
        WHERE user_id = ?
        ON CONFLICT(user_id, channel_id) DO UPDATE SET
          last_visited_at = MAX(user_recent_channels.last_visited_at, excluded.last_visited_at),
          pinned = MAX(user_recent_channels.pinned, excluded.pinned),
          bubble_color = COALESCE(user_recent_channels.bubble_color, excluded.bubble_color)
      `).bind(user.id, identity.userId),
      env.DB.prepare("DELETE FROM user_recent_channels WHERE user_id = ?").bind(identity.userId),
    ]);
  }

  return user.id;
}

function validColor(value: unknown): string | null {
  if (typeof value !== "string" || !COLOR_PATTERN.test(value)) return null;
  const color = value.toLowerCase();
  return color === "#3b8df0" ? "#3598fe" : color;
}

async function pruneRecentChannelsIfNeeded(env: Env, userId: string) {
  const overflow = await env.DB.prepare(`
    SELECT 1
    FROM user_recent_channels
    WHERE user_id = ?
    ORDER BY pinned DESC, last_visited_at DESC, channel_id DESC
    LIMIT 1 OFFSET ?
  `).bind(userId, RECENT_CHANNEL_LIMIT).first();
  if (!overflow) return;

  await env.DB.prepare(`
    DELETE FROM user_recent_channels
    WHERE user_id = ?
      AND channel_id NOT IN (
        SELECT channel_id
        FROM user_recent_channels
        WHERE user_id = ?
        ORDER BY pinned DESC, last_visited_at DESC, channel_id DESC
        LIMIT ?
      )
  `).bind(userId, userId, RECENT_CHANNEL_LIMIT).run();
}

export async function handleRecentChannels(request: Request, env: Env): Promise<Response> {
  const identity = authorize(request, env);
  if (!identity) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = await resolveRecentChannelUser(env, identity);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (request.method === "GET") {
    const { results: recentRows } = await env.DB.prepare(`
      SELECT channel_id, last_visited_at, pinned, bubble_color AS personal_bubble_color
      FROM user_recent_channels
      WHERE user_id = ?
      ORDER BY pinned DESC, last_visited_at DESC, channel_id DESC
      LIMIT ?
    `).bind(userId, RECENT_CHANNEL_LIMIT).all<{
      channel_id: string;
      last_visited_at: number;
      pinned: number;
      personal_bubble_color: string | null;
    }>();
    if (recentRows.length === 0) return Response.json({ channels: [] });

    const recentIds = recentRows.map((row) => row.channel_id);
    const recentPlaceholders = recentIds.map(() => "?").join(", ");
    const detailResults = await Promise.all(
      getChannelDatabaseMaintenanceScopes(env).map((scope) => {
        const channelEnv = withDatabase(env, scope.database);
        const predicates = [`c.id IN (${recentPlaceholders})`, "c.id NOT LIKE '%_live'"];
        const bindings: string[] = [...recentIds];
        if (scope.includeChannelIds.length > 0) {
          predicates.push(`c.id IN (${scope.includeChannelIds.map(() => "?").join(", ")})`);
          bindings.push(...scope.includeChannelIds);
        }
        if (scope.excludeChannelIds.length > 0) {
          predicates.push(`c.id NOT IN (${scope.excludeChannelIds.map(() => "?").join(", ")})`);
          bindings.push(...scope.excludeChannelIds);
        }
        return channelEnv.DB.prepare(`
      SELECT c.id, c.name, c.profile_image, c.bubble_color, c.created_at, c.owner_uid,
             c.passcode IS NOT NULL AS has_passcode,
             CASE WHEN live_config.id IS NOT NULL THEN 1 ELSE 0 END AS live_active
      FROM channels c
      LEFT JOIN config AS live_config
        ON live_config.id = 'live_' || c.id
       AND live_config.text IS NOT NULL
       AND live_config.text != 'false'
       AND json_extract(live_config.text, '$.active') = 1
       AND COALESCE(
         json_extract(live_config.text, '$.expiresAt'),
         strftime('%Y-%m-%dT%H:%M:%fZ', live_config.updated_at, '+8 hours')
       ) > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE ${predicates.join(" AND ")}
    `).bind(...bindings).all<{
          id: string;
          name: string;
          profile_image: string | null;
          bubble_color: string | null;
          created_at: string | null;
          owner_uid: string;
          has_passcode: number;
          live_active: number;
        }>();
      }),
    );
    const details = detailResults.flatMap((result) => result.results || []);
    const ownerIds = [...new Set(details.map((channel) => channel.owner_uid))];
    const ownerNames = new Map<string, string | null>();
    if (ownerIds.length > 0) {
      const { results } = await env.DB.prepare(`
        SELECT id, name
        FROM users
        WHERE id IN (${ownerIds.map(() => "?").join(", ")})
      `).bind(...ownerIds).all<{ id: string; name: string | null }>();
      for (const owner of results || []) ownerNames.set(owner.id, owner.name);
    }
    const detailsById = new Map(details.map((channel) => [channel.id, channel]));
    const channels = recentRows.flatMap((recent) => {
      const channel = detailsById.get(recent.channel_id);
      return channel ? [{
        ...channel,
        owner_name: ownerNames.get(channel.owner_uid) || null,
        last_visited_at: recent.last_visited_at,
        pinned: recent.pinned,
        personal_bubble_color: recent.personal_bubble_color,
      }] : [];
    });
    return Response.json({ channels });
  }

  if (request.method === "DELETE") {
    const channelId = new URL(request.url).searchParams.get("channel") || "";
    if (!CHANNEL_ID_PATTERN.test(channelId)) return Response.json({ error: "invalid channel" }, { status: 400 });
    await env.DB.prepare("DELETE FROM user_recent_channels WHERE user_id = ? AND channel_id = ?")
      .bind(userId, channelId).run();
    return Response.json({ ok: true });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const body = await request.json() as {
    action?: string;
    channel_id?: string;
    pinned?: boolean;
    bubble_color?: string;
    channels?: Array<{ id?: string; lastVisitedAt?: number; pinned?: boolean; bubbleColor?: string }>;
  };

  if (body.action === "merge") {
    const candidates = (body.channels || [])
      .filter((channel) => typeof channel.id === "string" && CHANNEL_ID_PATTERN.test(channel.id))
      .slice(0, 20);
    if (candidates.length === 0) return Response.json({ ok: true });
    const ids = [...new Set(candidates.map((channel) => channel.id!))];
    const placeholders = ids.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(`
      SELECT c.channel_id AS id, r.channel_id IS NOT NULL AS already_recent
      FROM channel_control_projections c
      LEFT JOIN user_recent_channels r
        ON r.user_id = ?
       AND r.channel_id = c.channel_id
      WHERE c.channel_id IN (${placeholders})
    `).bind(userId, ...ids).all<{ id: string; already_recent: number }>();
    const existingIds = new Set(results.map((row) => row.id));
    const mayAddRows = results.some((row) => !row.already_recent);
    const now = Date.now();
    const statements = candidates
      .filter((channel) => existingIds.has(channel.id!))
      .map((channel) => env.DB.prepare(`
        INSERT INTO user_recent_channels (user_id, channel_id, last_visited_at, pinned, bubble_color)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, channel_id) DO UPDATE SET
          last_visited_at = MAX(user_recent_channels.last_visited_at, excluded.last_visited_at),
          pinned = MAX(user_recent_channels.pinned, excluded.pinned),
          bubble_color = COALESCE(user_recent_channels.bubble_color, excluded.bubble_color)
      `).bind(
        userId,
        channel.id,
        Number.isFinite(channel.lastVisitedAt) ? Math.min(channel.lastVisitedAt!, now) : now,
        channel.pinned ? 1 : 0,
        validColor(channel.bubbleColor),
      ));
    if (statements.length) await env.DB.batch(statements);
    if (mayAddRows) {
      await pruneRecentChannelsIfNeeded(env, userId);
    }
    return Response.json({ ok: true });
  }

  const channelId = body.channel_id || "";
  if (!CHANNEL_ID_PATTERN.test(channelId)) return Response.json({ error: "invalid channel" }, { status: 400 });
  const channelExists = await env.DB.prepare(
    "SELECT 1 FROM channel_control_projections WHERE channel_id = ?"
  ).bind(channelId).first();
  if (!channelExists) return Response.json({ error: "channel not found" }, { status: 404 });

  if (body.action === "visit") {
    const visitedAt = Date.now();
    const updated = await env.DB.prepare(`
      UPDATE user_recent_channels
      SET last_visited_at = ?
      WHERE user_id = ? AND channel_id = ?
    `).bind(visitedAt, userId, channelId).run();
    if (!updated.meta.changes) {
      await env.DB.prepare(`
        INSERT INTO user_recent_channels (user_id, channel_id, last_visited_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, channel_id) DO UPDATE SET
          last_visited_at = excluded.last_visited_at
      `).bind(userId, channelId, visitedAt).run();
      await pruneRecentChannelsIfNeeded(env, userId);
    }
  } else if (body.action === "pin") {
    await env.DB.prepare(
      "UPDATE user_recent_channels SET pinned = ? WHERE user_id = ? AND channel_id = ?"
    ).bind(body.pinned ? 1 : 0, userId, channelId).run();
  } else if (body.action === "color") {
    const color = validColor(body.bubble_color);
    if (!color) return Response.json({ error: "invalid color" }, { status: 400 });
    const updated = await env.DB.prepare(`
      UPDATE user_recent_channels
      SET bubble_color = ?
      WHERE user_id = ? AND channel_id = ?
    `).bind(color, userId, channelId).run();
    if (!updated.meta.changes) {
      await env.DB.prepare(`
        INSERT INTO user_recent_channels (user_id, channel_id, last_visited_at, bubble_color)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, channel_id) DO UPDATE SET
          bubble_color = excluded.bubble_color
      `).bind(userId, channelId, Date.now(), color).run();
      await pruneRecentChannelsIfNeeded(env, userId);
    }
  } else {
    return Response.json({ error: "unknown action" }, { status: 400 });
  }

  const record = await env.DB.prepare(
    "SELECT bubble_color, pinned, last_visited_at FROM user_recent_channels WHERE user_id = ? AND channel_id = ?"
  ).bind(userId, channelId).first();
  return Response.json({ ok: true, record });
}
