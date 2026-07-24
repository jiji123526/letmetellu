import { Env } from "../types";
import { checkRateLimit, checkMessageLength, checkBannedWords } from "../lib/validation";

export async function handleMessages(request: Request, env: Env): Promise<Response> {
  if (request.method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const { uid, nick, text, channel_id, image, reply_to, fingerprint, report, reported_msg_id } = body;

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

    // Check channel exists (live channels use parent channel's config)
    const isLiveChannel = (channel_id as string).endsWith("_live");
    const parentChannelId = isLiveChannel ? (channel_id as string).replace(/_live$/, "") : channel_id as string;
    const channel = await env.DB.prepare("SELECT id, is_frozen, owner_uid FROM channels WHERE id = ?")
      .bind(parentChannelId).first();
    if (!channel) return Response.json({ error: "channel not found" }, { status: 404 });
    if (!isLiveChannel && channel.is_frozen) return Response.json({ error: "channel frozen" }, { status: 403 });

    // Check if user is blocked (check parent channel)
    const blocked = await env.DB.prepare("SELECT 1 FROM blocked WHERE (uid = ? OR fingerprint = ?) AND channel_id = ?")
      .bind(uid, fingerprint || "", parentChannelId).first();
    if (blocked) return Response.json({ error: "blocked" }, { status: 403 });

    // Banned words check (check parent channel)
    if (text) {
      const allowed = await checkBannedWords(text as string, parentChannelId, env);
      if (!allowed) return Response.json({ error: "banned_word" }, { status: 403 });
    }

    // Insert message (+ gallery if image) in a single batch
    const id = crypto.randomUUID();
    // Determine if sender is admin (channel owner — use parent channel)
    const isAdmin = (channel as any).owner_uid && uid === (channel as any).owner_uid ? 1 : 0;
    const stmts = [
      env.DB.prepare(`
        INSERT INTO messages (id, uid, auth_uid, nick, text, is_admin, channel_id, image, reply_to, fingerprint, report, reported_msg_id, gallery_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, uid, uid, nick || null, text || "", isAdmin, channel_id, image || null, reply_to || null, fingerprint || null, report ? 1 : 0, reported_msg_id || null, image ? id : null),
    ];
    if (image) {
      stmts.push(
        env.DB.prepare("INSERT INTO gallery (id, image, auth_uid, channel_id) VALUES (?, ?, ?, ?)")
          .bind(id, image, uid, channel_id)
      );
    }
    await env.DB.batch(stmts);

    // Broadcast via Durable Object
    // For live channels, only broadcast to the parent channel's DO (where clients connect)
    const broadcastChannelId = (channel_id as string).endsWith("_live")
      ? (channel_id as string).replace(/_live$/, "")
      : channel_id as string;
    const created_at = new Date().toISOString();
    const newMessage = {
      id, uid, auth_uid: uid, nick: nick || null, text: text || "", is_admin: isAdmin,
      channel_id, image: image || null, reply_to: reply_to || null, fingerprint: fingerprint || null,
      report: report ? 1 : 0, reported_msg_id: reported_msg_id || null, gallery_id: image ? id : null,
      deleted: 0, edited: 0, reactions: "{}", created_at,
    };
    const doId = env.CHAT_ROOM.idFromName(broadcastChannelId);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "message-new", message: newMessage }),
    }));

    return Response.json({ id, created_at });
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

    // Broadcast deletion with payload
    const broadcastChannelId = (channel_id as string).endsWith("_live")
      ? (channel_id as string).replace(/_live$/, "")
      : channel_id as string;
    const doId = env.CHAT_ROOM.idFromName(broadcastChannelId);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "message-deleted", message_id, soft: !!soft }),
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

    // Broadcast edit with payload
    const broadcastChannelId = (channel_id as string).endsWith("_live")
      ? (channel_id as string).replace(/_live$/, "")
      : channel_id as string;
    const doId = env.CHAT_ROOM.idFromName(broadcastChannelId);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "message-edited", message_id, text, edited: true }),
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

    // Broadcast reaction change with payload (no full refetch needed)
    const broadcastChannelId = (channel_id as string).endsWith("_live")
      ? (channel_id as string).replace(/_live$/, "")
      : channel_id as string;
    const doId = env.CHAT_ROOM.idFromName(broadcastChannelId);
    const stub = env.CHAT_ROOM.get(doId);
    await stub.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "reaction-changed", message_id, reactions: JSON.stringify(reactions) }),
    }));

    return Response.json({ ok: true, reactions });
  }

  return Response.json({ error: "method not allowed" }, { status: 405 });
}
