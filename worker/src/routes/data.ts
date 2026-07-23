import { Env } from "../types";

export async function handleData(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const channelId = url.searchParams.get("channel");

  if (!channelId) {
    return Response.json({ error: "missing channel" }, { status: 400 });
  }

  switch (type) {
    case "messages": {
      const cursor = url.searchParams.get("cursor");
      const limit = 50;

      let query = "SELECT * FROM messages WHERE channel_id = ? AND deleted = 0";
      const params: unknown[] = [channelId];

      if (cursor) {
        query += " AND created_at < ?";
        params.push(cursor);
      }

      query += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);

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
      const { results } = await env.DB.prepare(
        "SELECT * FROM gallery WHERE channel_id = ? ORDER BY created_at DESC LIMIT 100"
      ).bind(channelId).all();
      return Response.json({ gallery: results });
    }

    case "dm": {
      const { results } = await env.DB.prepare(
        "SELECT * FROM dm WHERE channel_id = ? ORDER BY created_at DESC LIMIT 100"
      ).bind(channelId).all();
      return Response.json({ dm: results });
    }

    default:
      return Response.json({ error: "unknown type" }, { status: 400 });
  }
}
