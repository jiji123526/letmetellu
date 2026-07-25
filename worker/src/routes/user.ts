import { Env } from "../types";

export async function handleUser(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const channelId = new URL(request.url).searchParams.get("channel");
    if (!channelId) return Response.json({ error: "missing channel" }, { status: 400 });

    const channel = await env.DB.prepare("SELECT owner_uid FROM channels WHERE id = ?")
      .bind(channelId).first() as { owner_uid: string } | null;
    if (!channel) return Response.json({ error: "channel not found" }, { status: 404 });

    const { results: channels } = await env.DB.prepare(
      `SELECT id, name, profile_image, bubble_color,
              passcode IS NOT NULL AS has_passcode
       FROM channels
       WHERE owner_uid = ? AND id NOT LIKE '%_live'
       ORDER BY created_at ASC
       LIMIT 50`
    ).bind(channel.owner_uid).all();
    return Response.json({ channels });
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
      "INSERT INTO users (id, email, name, image) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = ?, name = ?, image = ?"
    ).bind(id, email, name || null, image || null, email, name || null, image || null).run();

    // Fetch user's channels
    const { results: channels } = await env.DB.prepare(
      "SELECT id, name, profile_image, bubble_color, created_at, passcode IS NOT NULL AS has_passcode FROM channels WHERE owner_uid = ?"
    ).bind(id).all();

    return Response.json({ ok: true, channels });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}
