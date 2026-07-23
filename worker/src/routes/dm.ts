import { Env } from "../types";

export async function handleDm(request: Request, env: Env): Promise<Response> {
  if (request.method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const { uid, nick, text, channel_id, image } = body;

    if (!channel_id || !uid) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO dm (id, uid, auth_uid, nick, text, image, channel_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, uid, uid, nick || null, text || "", image || null, channel_id).run();

    // Broadcast DM to admin via DO
    const doId = env.CHAT_ROOM.idFromName(channel_id as string);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "dm-changed", channel_id }),
    }));

    return Response.json({ id, created_at: new Date().toISOString() });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}
