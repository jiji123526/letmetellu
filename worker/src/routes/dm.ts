import { Env } from "../types";

export async function handleDm(request: Request, env: Env): Promise<Response> {
  if (request.method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const { uid, nick, text, channel_id, image } = body;

    if (!channel_id || !uid) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO dm (id, uid, auth_uid, nick, text, image, channel_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, uid, uid, nick || null, text || "", image || null, channel_id).run();

    // Broadcast DM with payload — always use parent channel DO
    const parentChannelId = (channel_id as string).endsWith("_live")
      ? (channel_id as string).replace(/_live$/, "")
      : channel_id as string;
    const doId = env.CHAT_ROOM.idFromName(parentChannelId);
    const stub = env.CHAT_ROOM.get(doId);
    const newDm = { id, uid, auth_uid: uid, nick: nick || null, text: text || "", image: image || null, channel_id, created_at };
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "dm-new", dm: newDm }),
    }));

    return Response.json({ id, created_at });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}
