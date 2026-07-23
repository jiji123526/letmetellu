import { Env } from "../types";
import { checkRateLimit, checkMessageLength, checkBannedWords } from "../lib/validation";

export async function handleMessages(request: Request, env: Env): Promise<Response> {
  if (request.method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const { uid, nick, text, channel_id, image, reply_to, fingerprint } = body;

    if (!channel_id || !uid) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Rate limit check
    if (!checkRateLimit(uid as string)) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }

    // Message length check
    if (text && !checkMessageLength(text as string)) {
      return Response.json({ error: "message_too_long" }, { status: 400 });
    }

    // Check channel exists
    const channel = await env.DB.prepare("SELECT id, is_frozen, owner_uid FROM channels WHERE id = ?")
      .bind(channel_id).first();
    if (!channel) return Response.json({ error: "channel not found" }, { status: 404 });
    if (channel.is_frozen) return Response.json({ error: "channel frozen" }, { status: 403 });

    // Check if user is blocked
    const blocked = await env.DB.prepare("SELECT 1 FROM blocked WHERE (uid = ? OR fingerprint = ?) AND channel_id = ?")
      .bind(uid, fingerprint || "", channel_id).first();
    if (blocked) return Response.json({ error: "blocked" }, { status: 403 });

    // Banned words check
    if (text) {
      const allowed = await checkBannedWords(text as string, channel_id as string, env);
      if (!allowed) return Response.json({ error: "banned_word" }, { status: 403 });
    }

    // Insert message
    const id = crypto.randomUUID();
    // Determine if sender is admin (channel owner)
    const isAdmin = (channel as any).owner_uid && uid === (channel as any).owner_uid ? 1 : 0;
    await env.DB.prepare(`
      INSERT INTO messages (id, uid, auth_uid, nick, text, is_admin, channel_id, image, reply_to, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, uid, uid, nick || null, text || "", isAdmin, channel_id, image || null, reply_to || null, fingerprint || null).run();

    // Broadcast via Durable Object
    const doId = env.CHAT_ROOM.idFromName(channel_id as string);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "message-changed", channel_id }),
    }));

    return Response.json({ id, created_at: new Date().toISOString() });
  }

  // DELETE — hard delete (remove message) or soft delete (mark as deleted)
  if (request.method === "DELETE") {
    const body = await request.json() as Record<string, unknown>;
    const { uid, message_id, channel_id, soft } = body;

    if (!message_id || !uid || !channel_id) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Verify ownership
    const msg = await env.DB.prepare("SELECT uid FROM messages WHERE id = ? AND channel_id = ?")
      .bind(message_id, channel_id).first();
    if (!msg) return Response.json({ error: "not found" }, { status: 404 });
    if (msg.uid !== uid) return Response.json({ error: "not owner" }, { status: 403 });

    if (soft) {
      // Soft delete — mark as deleted, clear text/image
      await env.DB.prepare("UPDATE messages SET deleted = 1, text = '삭제된 채팅입니다', image = NULL WHERE id = ?")
        .bind(message_id).run();
    } else {
      // Hard delete — remove from DB
      await env.DB.prepare("DELETE FROM messages WHERE id = ?")
        .bind(message_id).run();
    }

    // Broadcast
    const doId = env.CHAT_ROOM.idFromName(channel_id as string);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "message-changed", channel_id }),
    }));

    return Response.json({ ok: true });
  }

  // PUT — edit message
  if (request.method === "PUT") {
    const body = await request.json() as Record<string, unknown>;
    const { uid, message_id, channel_id, text } = body;

    if (!message_id || !uid || !channel_id || text === undefined) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Verify ownership
    const msg = await env.DB.prepare("SELECT uid FROM messages WHERE id = ? AND channel_id = ?")
      .bind(message_id, channel_id).first();
    if (!msg) return Response.json({ error: "not found" }, { status: 404 });
    if (msg.uid !== uid) return Response.json({ error: "not owner" }, { status: 403 });

    await env.DB.prepare("UPDATE messages SET text = ?, edited = 1 WHERE id = ?")
      .bind(text, message_id).run();

    // Broadcast
    const doId = env.CHAT_ROOM.idFromName(channel_id as string);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "message-changed", channel_id }),
    }));

    return Response.json({ ok: true });
  }

  // PATCH — toggle reaction
  if (request.method === "PATCH") {
    const body = await request.json() as Record<string, unknown>;
    const { uid, message_id, channel_id, emoji } = body;

    if (!message_id || !uid || !channel_id || !emoji) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Get current reactions
    const msg = await env.DB.prepare("SELECT reactions FROM messages WHERE id = ? AND channel_id = ?")
      .bind(message_id, channel_id).first() as { reactions: string } | null;
    if (!msg) return Response.json({ error: "not found" }, { status: 404 });

    const reactions: Record<string, string> = JSON.parse(msg.reactions || "{}");
    const key = `${uid}_${(emoji as string).codePointAt(0)?.toString(16)}`;

    // Toggle: if exists remove, otherwise add
    if (reactions[key]) {
      delete reactions[key];
    } else {
      reactions[key] = emoji as string;
    }

    await env.DB.prepare("UPDATE messages SET reactions = ? WHERE id = ?")
      .bind(JSON.stringify(reactions), message_id).run();

    // Broadcast
    const doId = env.CHAT_ROOM.idFromName(channel_id as string);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "message-changed", channel_id }),
    }));

    return Response.json({ ok: true, reactions });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}
