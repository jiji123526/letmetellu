import { Env } from "../types";

export async function handleUser(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const existenceQuery = url.searchParams.get("exists");
    if (existenceQuery !== null) {
      const ids = [...new Set(
        existenceQuery.split(",").filter((id) => /^[a-z0-9-]{3,30}$/.test(id))
      )].slice(0, 20);
      if (ids.length === 0) return Response.json({ existingIds: [] });
      const placeholders = ids.map(() => "?").join(", ");
      const { results } = await env.DB.prepare(
        `SELECT channels.id, channels.name, channels.profile_image,
                channels.bubble_color, channels.created_at,
                channels.passcode IS NOT NULL AS has_passcode,
                users.name AS owner_name
         FROM channels
         LEFT JOIN users ON users.id = channels.owner_uid
         WHERE channels.id IN (${placeholders}) AND channels.id NOT LIKE '%_live'`
      ).bind(...ids).all<{ id: string }>();
      return Response.json({ existingIds: results.map((row) => row.id), channels: results });
    }

    const channelId = url.searchParams.get("channel");
    if (!channelId) return Response.json({ error: "missing channel" }, { status: 400 });

    const channel = await env.DB.prepare("SELECT owner_uid FROM channels WHERE id = ?")
      .bind(channelId).first() as { owner_uid: string } | null;
    if (!channel) return Response.json({ error: "channel not found" }, { status: 404 });

    const { results: channels } = await env.DB.prepare(
      `SELECT id, name, profile_image, bubble_color,
              passcode IS NOT NULL AS has_passcode
       FROM channels
       WHERE owner_uid = ?
         AND id NOT LIKE '%_live'
         AND show_on_profile = 1
       ORDER BY created_at ASC
       LIMIT 50`
    ).bind(channel.owner_uid).all();
    return Response.json({ channels });
  }

  if (request.method === "PATCH") {
    if (request.headers.get("X-Internal-Token") !== env.INTERNAL_SECRET) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const userId = request.headers.get("X-User-Id") || "";
    const body = await request.json() as { font_size?: number };
    const fontSize = Number(body.font_size);
    if (!userId || !Number.isInteger(fontSize) || fontSize < 12 || fontSize > 20) {
      return Response.json({ error: "invalid preference" }, { status: 400 });
    }
    await env.DB.prepare("UPDATE users SET font_size = ? WHERE id = ?")
      .bind(fontSize, userId).run();
    return Response.json({ ok: true, font_size: fontSize });
  }

  if (request.method === "POST") {
    // Verify internal token (only Vercel proxy should call this)
    const token = request.headers.get("X-Internal-Token");
    if (token !== env.INTERNAL_SECRET) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await request.json() as { id: string; email: string; name?: string; image?: string };
    const { id, email, name, image } = body;

    if (!id || !email) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Upsert user
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, image, email_verified_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         email = ?,
         name = ?,
         image = ?,
         email_verified_at = COALESCE(users.email_verified_at, datetime('now'))`
    ).bind(id, email, name || null, image || null, email, name || null, image || null).run();

    // Fetch user's channels
    const { results: channels } = await env.DB.prepare(
      `SELECT channels.id, channels.name, channels.profile_image,
              channels.bubble_color, channels.created_at,
              COALESCE(
                (SELECT MAX(messages.created_at) FROM messages WHERE messages.channel_id = channels.id AND messages.deleted = 0),
                channels.created_at
              ) AS last_message_at,
              channels.passcode IS NOT NULL AS has_passcode,
              users.name AS owner_name,
              (SELECT CASE WHEN config.text IS NOT NULL AND config.text != 'false' AND json_extract(config.text, '$.active') = 1 THEN 1 ELSE 0 END
               FROM config WHERE config.id = 'live_' || channels.id) AS live_active
       FROM channels
       LEFT JOIN users ON users.id = channels.owner_uid
       WHERE channels.owner_uid = ? AND channels.id NOT LIKE '%_live'`
    ).bind(id).all();

    const preferences = await env.DB.prepare("SELECT font_size FROM users WHERE id = ?")
      .bind(id).first<{ font_size: number | null }>();
    return Response.json({ ok: true, channels, font_size: preferences?.font_size ?? null });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}
