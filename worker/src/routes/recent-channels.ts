import { Env } from "../types";

const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

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
  return typeof value === "string" && COLOR_PATTERN.test(value) ? value.toLowerCase() : null;
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
             r.last_visited_at, r.pinned, r.bubble_color AS personal_bubble_color
      FROM user_recent_channels r
      INNER JOIN channels c ON c.id = r.channel_id AND c.id NOT LIKE '%_live'
      LEFT JOIN users u ON u.id = c.owner_uid
      WHERE r.user_id = ?
      ORDER BY r.pinned DESC, r.last_visited_at DESC
    `).bind(userId).all();
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
    const { results } = await env.DB.prepare(
      `SELECT id FROM channels WHERE id IN (${placeholders}) AND id NOT LIKE '%_live'`
    ).bind(...ids).all<{ id: string }>();
    const existingIds = new Set(results.map((row) => row.id));
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
    return Response.json({ ok: true });
  }

  const channelId = body.channel_id || "";
  if (!CHANNEL_ID_PATTERN.test(channelId)) return Response.json({ error: "invalid channel" }, { status: 400 });
  const channelExists = await env.DB.prepare(
    "SELECT 1 FROM channels WHERE id = ? AND id NOT LIKE '%_live'"
  ).bind(channelId).first();
  if (!channelExists) return Response.json({ error: "channel not found" }, { status: 404 });

  if (body.action === "visit") {
    await env.DB.prepare(`
      INSERT INTO user_recent_channels (user_id, channel_id, last_visited_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET last_visited_at = excluded.last_visited_at
    `).bind(userId, channelId, Date.now()).run();
  } else if (body.action === "pin") {
    await env.DB.prepare(
      "UPDATE user_recent_channels SET pinned = ? WHERE user_id = ? AND channel_id = ?"
    ).bind(body.pinned ? 1 : 0, userId, channelId).run();
  } else if (body.action === "color") {
    const color = validColor(body.bubble_color);
    if (!color) return Response.json({ error: "invalid color" }, { status: 400 });
    await env.DB.prepare(`
      INSERT INTO user_recent_channels (user_id, channel_id, last_visited_at, bubble_color)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET bubble_color = excluded.bubble_color
    `).bind(userId, channelId, Date.now(), color).run();
  } else {
    return Response.json({ error: "unknown action" }, { status: 400 });
  }

  const record = await env.DB.prepare(
    "SELECT bubble_color, pinned, last_visited_at FROM user_recent_channels WHERE user_id = ? AND channel_id = ?"
  ).bind(userId, channelId).first();
  return Response.json({ ok: true, record });
}
