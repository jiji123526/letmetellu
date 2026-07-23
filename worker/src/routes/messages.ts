import { Env } from "../types";

export async function handleMessages(request: Request, env: Env): Promise<Response> {
  if (request.method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const { uid, nick, text, channel_id, image, reply_to, fingerprint } = body;

    if (!channel_id || !uid) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Check channel exists
    const channel = await env.DB.prepare("SELECT id, is_frozen FROM channels WHERE id = ?")
      .bind(channel_id).first();
    if (!channel) return Response.json({ error: "channel not found" }, { status: 404 });
    if (channel.is_frozen) return Response.json({ error: "channel frozen" }, { status: 403 });

    // Check if user is blocked
    const blocked = await env.DB.prepare("SELECT 1 FROM blocked WHERE uid = ? AND channel_id = ?")
      .bind(uid, channel_id).first();
    if (blocked) return Response.json({ error: "blocked" }, { status: 403 });

    // Insert message
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO messages (id, uid, auth_uid, nick, text, channel_id, image, reply_to, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, uid, uid, nick || null, text || "", channel_id, image || null, reply_to || null, fingerprint || null).run();

    // Broadcast via Durable Object
    const doId = env.CHAT_ROOM.idFromName(channel_id as string);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "message-changed", channel_id }),
    }));

    return Response.json({ id, created_at: new Date().toISOString() });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}
