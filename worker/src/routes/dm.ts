import { Env } from "../types";
import { verifyRoomToken } from "./passcode";
import { getChannelPasscodeInfo } from "../lib/validation";

export async function handleDm(request: Request, env: Env): Promise<Response> {
  if (request.method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const { uid, nick, text, channel_id, image } = body;

    if (!channel_id || !uid) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Passcode gate
    const parentChannelId = (channel_id as string).endsWith("_live") ? (channel_id as string).replace(/_live$/, "") : channel_id as string;
    const { passcode } = await getChannelPasscodeInfo(parentChannelId, env);
    if (passcode) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
      const decoded = await verifyRoomToken(roomToken, env);
      if (!decoded || decoded.channel_id !== parentChannelId || decoded.passcode_hash !== passcode) {
        return Response.json({ error: "invalid token" }, { status: 403 });
      }
    }

    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO dm (id, uid, auth_uid, nick, text, image, channel_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, uid, uid, nick || null, text || "", image || null, channel_id).run();

    // Broadcast DM with payload — always use parent channel DO
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
