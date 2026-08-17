import { Env } from "../types";

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
  return { userId: userId || "", userEmail };
}

async function resolveRecentChannelUser(
  env: Env,
  identity: { userId: string; userEmail: string },
) {
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
    const { results } = await env.DB.prepare(`
      SELECT c.id, c.name, c.profile_image, c.bubble_color, c.created_at, c.owner_uid,
             c.passcode IS NOT NULL AS has_passcode,
             u.name AS owner_name,
             r.last_visited_at, r.pinned, r.bubble_color AS personal_bubble_color,
             CASE WHEN live_config.id IS NOT NULL THEN 1 ELSE 0 END AS live_active
      FROM user_recent_channels r
      INNER JOIN channels c ON c.id = r.channel_id AND c.id NOT LIKE '%_live'
      LEFT JOIN users u ON u.id = c.owner_uid
      LEFT JOIN config AS live_config
        ON live_config.id = 'live_' || c.id
       AND live_config.text IS NOT NULL
       AND live_config.text != 'false'
       AND json_extract(live_config.text, '$.active') = 1
       AND COALESCE(
         json_extract(live_config.text, '$.expiresAt'),
         strftime('%Y-%m-%dT%H:%M:%fZ', live_config.updated_at, '+8 hours')
       ) > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE r.user_id = ?
      ORDER BY r.pinned DESC, r.last_visited_at DESC, r.channel_id DESC
      LIMIT ?
    `).bind(userId, RECENT_CHANNEL_LIMIT).all();
    return Response.json({ channels: results });
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
      SELECT c.id, r.channel_id IS NOT NULL AS already_recent
      FROM channels c
      LEFT JOIN user_recent_channels r
        ON r.user_id = ?
       AND r.channel_id = c.id
      WHERE c.id IN (${placeholders})
        AND c.id NOT LIKE '%_live'
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
    "SELECT 1 FROM channels WHERE id = ? AND id NOT LIKE '%_live'"
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
