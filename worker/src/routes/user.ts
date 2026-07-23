import { Env } from "../types";

export async function handleUser(request: Request, env: Env): Promise<Response> {
  if (request.method === "POST") {
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
      "SELECT id, name, profile_image, bubble_color, created_at FROM channels WHERE owner_uid = ?"
    ).bind(id).all();

    return Response.json({ ok: true, channels });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}
