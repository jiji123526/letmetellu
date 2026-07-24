import { Env } from "../types";
import { verifyRoomToken } from "./passcode";

export async function handleData(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const channelId = url.searchParams.get("channel");

  if (!channelId) {
    return Response.json({ error: "missing channel" }, { status: 400 });
  }

  // Passcode gate for data endpoints
  const parentChannelId = channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
  const channel = await env.DB.prepare("SELECT passcode, owner_uid FROM channels WHERE id = ?")
    .bind(parentChannelId).first() as { passcode: string | null; owner_uid: string } | null;

  if (channel?.passcode) {
    // Check owner bypass
    const internalToken = request.headers.get("X-Internal-Token");
    const userId = request.headers.get("X-User-Id");
    const isOwner = internalToken === env.INTERNAL_SECRET && userId === channel.owner_uid;

    if (!isOwner) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
      const decoded = await verifyRoomToken(roomToken, env);
      if (!decoded || decoded.channel_id !== parentChannelId || decoded.passcode_hash !== channel.passcode) {
        return Response.json({ error: "invalid token" }, { status: 403 });
      }
    }
  }

  switch (type) {
    case "messages": {
      const cursor = url.searchParams.get("cursor");
      const limit = 50;

      let innerQuery = "SELECT * FROM messages WHERE channel_id = ? AND deleted = 0";
      const params: unknown[] = [channelId];

      if (cursor) {
        innerQuery += " AND created_at < ?";
        params.push(cursor);
      }

      innerQuery += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);

      const query = `SELECT * FROM (${innerQuery}) ORDER BY created_at ASC`;
      const stmt = env.DB.prepare(query);
      const { results } = await stmt.bind(...params).all();
      return Response.json({ messages: results });
    }

    case "blocked": {
      const { results } = await env.DB.prepare("SELECT * FROM blocked WHERE channel_id = ?")
        .bind(channelId).all();
      return Response.json({ blocked: results });
    }

    case "gallery": {
      const cursor = url.searchParams.get("cursor");
      let query = "SELECT * FROM gallery WHERE channel_id = ?";
      const params: unknown[] = [channelId];
      if (cursor) {
        query += " AND created_at < ?";
        params.push(cursor);
      }
      query += " ORDER BY created_at DESC LIMIT 50";
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return Response.json({ gallery: results });
    }

    case "dm": {
      const { results } = await env.DB.prepare(
        "SELECT * FROM dm WHERE channel_id = ? ORDER BY created_at DESC LIMIT 100"
      ).bind(channelId).all();
      return Response.json({ dm: results });
    }

    case "links": {
      const cursor = url.searchParams.get("cursor");
      let query = "SELECT id, text, created_at FROM messages WHERE channel_id = ? AND deleted = 0 AND (text LIKE '%http://%' OR text LIKE '%https://%' OR text LIKE '%www.%')";
      const params: unknown[] = [channelId];
      if (cursor) {
        query += " AND created_at < ?";
        params.push(cursor);
      }
      query += " ORDER BY created_at DESC LIMIT 30";
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return Response.json({ links: results });
    }

    case "search": {
      const query = url.searchParams.get("q");
      if (!query) return Response.json({ results: [] });
      const { results } = await env.DB.prepare(
        "SELECT m.* FROM messages m JOIN messages_fts ON m.rowid = messages_fts.rowid WHERE messages_fts.text MATCH ? AND m.channel_id = ? AND m.deleted = 0 ORDER BY m.created_at DESC LIMIT 30"
      ).bind(query, channelId).all();
      return Response.json({ results });
    }

    case "banned-words": {
      const { results } = await env.DB.prepare(
        "SELECT * FROM banned_words WHERE channel_id = ? AND (expires IS NULL OR expires > datetime('now'))"
      ).bind(channelId).all();
      return Response.json({ bannedWords: results });
    }

    default:
      return Response.json({ error: "unknown type" }, { status: 400 });
  }
}
