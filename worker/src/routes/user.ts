import { Env } from "../types";
import { getReportsChannelId } from "../lib/special-channels";
import { deleteChannel } from "./admin";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function handleUser(request: Request, env: Env): Promise<Response> {
  const reportsChannelId = getReportsChannelId(env);
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
         WHERE channels.id IN (${placeholders}) AND channels.id NOT LIKE '%_live'
           ${reportsChannelId ? "AND channels.id != ?" : ""}`
      ).bind(...ids, ...(reportsChannelId ? [reportsChannelId] : [])).all<{ id: string }>();
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
         ${reportsChannelId ? "AND id != ?" : ""}
         AND show_on_profile = 1
       ORDER BY created_at ASC
       LIMIT 50`
    ).bind(channel.owner_uid, ...(reportsChannelId ? [reportsChannelId] : [])).all();
    return Response.json({ channels });
  }

  if (request.method === "PATCH") {
    if (request.headers.get("X-Internal-Token") !== env.INTERNAL_SECRET) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const userId = request.headers.get("X-User-Id") || "";
    const body = await request.json() as { font_size?: number; locale?: string };
    const fontSize = Number(body.font_size);
    const hasFontSize = Number.isInteger(fontSize) && fontSize >= 12 && fontSize <= 20;
    const locale = body.locale === "en" ? "en" : body.locale === "ko" ? "ko" : null;
    if (!userId || (!hasFontSize && !locale)) {
      return Response.json({ error: "invalid preference" }, { status: 400 });
    }
    const updates: string[] = [];
    const binds: Array<number | string> = [];
    if (hasFontSize) {
      updates.push("font_size = ?");
      binds.push(fontSize);
    }
    if (locale) {
      updates.push("locale = ?");
      binds.push(locale);
    }
    binds.push(userId);
    await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...binds).run();
    return Response.json({ ok: true, ...(hasFontSize ? { font_size: fontSize } : {}), ...(locale ? { locale } : {}) });
  }

  if (request.method === "DELETE") {
    if (request.headers.get("X-Internal-Token") !== env.INTERNAL_SECRET) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const userId = request.headers.get("X-User-Id") || "";
    const userEmail = normalizeEmail(request.headers.get("X-User-Email") || "");
    if (!userId && !userEmail) {
      return Response.json({ error: "missing user identity" }, { status: 400 });
    }
    const userById = userId
      ? await env.DB.prepare("SELECT id, email FROM users WHERE id = ?")
        .bind(userId).first<{ id: string; email: string }>()
      : null;
    const user = userById || (userEmail
      ? await env.DB.prepare("SELECT id, email FROM users WHERE lower(email) = ?")
        .bind(userEmail).first<{ id: string; email: string }>()
      : null);
    if (!user) return Response.json({ error: "user not found" }, { status: 404 });
    const { results: ownedChannels } = await env.DB.prepare(
      "SELECT id FROM channels WHERE owner_uid = ? AND id NOT LIKE '%_live'"
    ).bind(user.id).all<{ id: string }>();
    for (const channel of ownedChannels) {
      await deleteChannel(channel.id, env);
    }

    await env.DB.batch([
      env.DB.prepare("DELETE FROM user_recent_channels WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(user.id),
      env.DB.prepare("UPDATE messages SET auth_uid = '' WHERE auth_uid = ?").bind(user.id),
      env.DB.prepare("UPDATE dm SET auth_uid = NULL WHERE auth_uid = ?").bind(user.id),
      env.DB.prepare("UPDATE gallery SET auth_uid = NULL WHERE auth_uid = ?").bind(user.id),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
    ]);
    return Response.json({ ok: true, deleted_channels: ownedChannels.length });
  }

  if (request.method === "POST") {
    // Verify internal token (only Vercel proxy should call this)
    const token = request.headers.get("X-Internal-Token");
    if (token !== env.INTERNAL_SECRET) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await request.json() as { id: string; email: string; name?: string; image?: string; flow?: "login" | "signup" | "sync" };
    const { id, email, name, image } = body;
    const flow = body.flow === "login" || body.flow === "signup" || body.flow === "sync"
      ? body.flow
      : "sync";

    if (!id || !email) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    const normalizedEmail = normalizeEmail(email);
    const existingUser = await env.DB.prepare(
      "SELECT id FROM users WHERE lower(email) = ? LIMIT 1"
    ).bind(normalizedEmail).first<{ id: string }>();

    if (flow === "login" && !existingUser) {
      return Response.json({ error: "user_not_found" }, { status: 404 });
    }
    if (flow === "signup" && existingUser) {
      return Response.json({ error: "account_exists" }, { status: 409 });
    }
    if (flow === "sync" && !existingUser) {
      return Response.json({ error: "user_not_found" }, { status: 404 });
    }

    const canonicalUserId = existingUser?.id || id;

    if (existingUser) {
      await env.DB.prepare(
        `UPDATE users
         SET name = ?, image = ?,
             email_verified_at = COALESCE(email_verified_at, datetime('now'))
         WHERE id = ?`
      ).bind(name || null, image || null, canonicalUserId).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO users (id, email, name, image, email_verified_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           email = excluded.email,
           name = excluded.name,
           image = excluded.image,
           email_verified_at = COALESCE(users.email_verified_at, datetime('now'))`
      ).bind(canonicalUserId, normalizedEmail, name || null, image || null).run();
    }

    if (canonicalUserId !== id) {
      await env.DB.batch([
        env.DB.prepare(`
          INSERT OR IGNORE INTO user_recent_channels
            (user_id, channel_id, last_visited_at, pinned, bubble_color)
          SELECT ?, channel_id, last_visited_at, pinned, bubble_color
          FROM user_recent_channels
          WHERE user_id = ?
        `).bind(canonicalUserId, id),
        env.DB.prepare("DELETE FROM user_recent_channels WHERE user_id = ?").bind(id),
        env.DB.prepare("UPDATE channels SET owner_uid = ? WHERE owner_uid = ?")
          .bind(canonicalUserId, id),
      ]);
    }

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
    ).bind(canonicalUserId).all();

    const preferences = await env.DB.prepare("SELECT font_size, locale FROM users WHERE id = ?")
      .bind(canonicalUserId).first<{ font_size: number | null; locale: string | null }>();
    return Response.json({
      ok: true,
      user_id: canonicalUserId,
      channels,
      font_size: preferences?.font_size ?? null,
      locale: preferences?.locale === "en" ? "en" : preferences?.locale === "ko" ? "ko" : null,
    });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}
