import { Env } from "../types";
import { checkRateLimit, checkMessageLength, checkBannedWords, getChannelPasscodeInfo } from "../lib/validation";
import { verifyRoomToken } from "./passcode";

export async function handleMessages(request: Request, env: Env): Promise<Response> {
  if (request.method === "POST") {
    const body = await request.json() as Record<string, unknown>;
    const { uid, nick, text, channel_id, image, reply_to, fingerprint, report, reported_msg_id } = body;

    if (!channel_id || !uid) {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    // Internal proxy authentication alone does not grant channel-owner rights.
    // Ownership is verified against the target channel below.
    const internalToken = request.headers.get("X-Internal-Token");
    const verifiedUserId = request.headers.get("X-User-Id");
    const hasVerifiedIdentity = internalToken === env.INTERNAL_SECRET && !!verifiedUserId;

    // Passcode gate — check if channel requires passcode for writing
    const isLiveChannel = (channel_id as string).endsWith("_live");
    const parentChannelId = isLiveChannel ? (channel_id as string).replace(/_live$/, "") : channel_id as string;
    const channel = await env.DB.prepare(`
      SELECT id, is_frozen, owner_uid, passcode,
        (SELECT is_frozen FROM channels WHERE id = ?) AS target_is_frozen
      FROM channels
      WHERE id = ?
    `).bind(channel_id, parentChannelId).first();
    if (!channel) return Response.json({ error: "channel not found" }, { status: 404 });
    const isChannelOwner = hasVerifiedIdentity && (channel as any).owner_uid === verifiedUserId;

    if ((channel as any).passcode && !isChannelOwner) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
      const decoded = await verifyRoomToken(roomToken, env);
      if (!decoded || decoded.channel_id !== parentChannelId || decoded.passcode_hash !== (channel as any).passcode) {
        return Response.json({ error: "invalid token" }, { status: 403 });
      }
    }

    // The target channel's freeze state is fetched with the parent channel,
    // avoiding a second D1 round trip for live messages.
    const isTargetFrozen = isLiveChannel
      ? (channel as any).target_is_frozen
      : (channel as any).is_frozen;
    if (isTargetFrozen && !isChannelOwner) {
      return Response.json({ error: "channel frozen" }, { status: 403 });
    }

    // Rate limit check
    if (!checkRateLimit(uid as string)) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }

    // Message length check
    if (text && !checkMessageLength(text as string)) {
      return Response.json({ error: "message_too_long" }, { status: 400 });
    }

    // These are independent read-only checks. Run them together only after
    // passcode, freeze, rate-limit and length validation have succeeded.
    const [blocked, allowedByBannedWords] = await Promise.all([
      env.DB.prepare("SELECT 1 FROM blocked WHERE (uid = ? OR fingerprint = ?) AND channel_id = ?")
        .bind(uid, fingerprint || "", parentChannelId).first(),
      text
        ? checkBannedWords(text as string, parentChannelId, env)
        : Promise.resolve(true),
    ]);
    if (blocked) return Response.json({ error: "blocked" }, { status: 403 });

    if (!allowedByBannedWords) {
      return Response.json({ error: "banned_word" }, { status: 403 });
    }

    // Insert message (+ gallery if image) in a single batch
    const id = crypto.randomUUID();
    // D1's datetime('now') default has only second precision. Persist an
    // explicit millisecond timestamp so consecutive photo messages keep their
    // original order after reconnecting.
    const created_at = new Date().toISOString();
    // Only a verified owner is stored and broadcast as the channel admin.
    const senderUid = isChannelOwner ? verifiedUserId! : uid as string;
    const isAdmin = isChannelOwner ? 1 : 0;
    const stmts = [
      env.DB.prepare(`
        INSERT INTO messages (id, uid, auth_uid, nick, text, is_admin, channel_id, image, reply_to, fingerprint, report, reported_msg_id, gallery_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, senderUid, senderUid, nick || null, text || "", isAdmin, channel_id, image || null, reply_to || null, fingerprint || null, report ? 1 : 0, reported_msg_id || null, image ? id : null, created_at),
    ];
    if (image) {
      stmts.push(
        env.DB.prepare("INSERT INTO gallery (id, image, auth_uid, channel_id, created_at) VALUES (?, ?, ?, ?, ?)")
          .bind(id, image, senderUid, channel_id, created_at)
      );
    }
    await env.DB.batch(stmts);

    // Broadcast via Durable Object
    // For live channels, only broadcast to the parent channel's DO (where clients connect)
    const broadcastChannelId = (channel_id as string).endsWith("_live")
      ? (channel_id as string).replace(/_live$/, "")
      : channel_id as string;
    const newMessage = {
      id, uid: senderUid, auth_uid: senderUid, nick: nick || null, text: text || "", is_admin: isAdmin,
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

    // Passcode gate
    const delParent = (channel_id as string).endsWith("_live") ? (channel_id as string).replace(/_live$/, "") : channel_id as string;
    const { passcode: delPasscode } = await getChannelPasscodeInfo(delParent, env);
    if (delPasscode) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
      const decoded = await verifyRoomToken(roomToken, env);
      if (!decoded || decoded.channel_id !== delParent || decoded.passcode_hash !== delPasscode) {
        return Response.json({ error: "invalid token" }, { status: 403 });
      }
    }

    // Verify ownership
    const msg = await env.DB.prepare("SELECT uid FROM messages WHERE id = ? AND channel_id = ?")
      .bind(message_id, channel_id).first();
    if (!msg) return Response.json({ error: "not found" }, { status: 404 });
    if (msg.uid !== uid) return Response.json({ error: "not owner" }, { status: 403 });

    if (soft) {
      // Keep the reply placeholder, but remove its media from both collections.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM gallery WHERE id = ? AND channel_id = ?")
          .bind(message_id, channel_id),
        env.DB.prepare("UPDATE messages SET deleted = 1, text = '삭제된 채팅입니다', image = NULL, gallery_id = NULL WHERE id = ? AND channel_id = ?")
          .bind(message_id, channel_id),
      ]);
    } else {
      // Hard delete — remove the message and its gallery entry together.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM gallery WHERE id = ? AND channel_id = ?")
          .bind(message_id, channel_id),
        env.DB.prepare("DELETE FROM messages WHERE id = ? AND channel_id = ?")
          .bind(message_id, channel_id),
      ]);
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
    const { uid, message_id, channel_id, text, fingerprint } = body;

    if (!message_id || !uid || !channel_id || typeof text !== "string") {
      return Response.json({ error: "missing required fields" }, { status: 400 });
    }

    const internalToken = request.headers.get("X-Internal-Token");
    const verifiedUserId = request.headers.get("X-User-Id");
    const hasVerifiedIdentity = internalToken === env.INTERNAL_SECRET && !!verifiedUserId;

    // Passcode gate
    const isLiveChannel = (channel_id as string).endsWith("_live");
    const editParent = isLiveChannel ? (channel_id as string).replace(/_live$/, "") : channel_id as string;
    const channel = await env.DB.prepare(`
      SELECT id, is_frozen, owner_uid, passcode,
        (SELECT is_frozen FROM channels WHERE id = ?) AS target_is_frozen
      FROM channels
      WHERE id = ?
    `).bind(channel_id, editParent).first();
    if (!channel) return Response.json({ error: "channel not found" }, { status: 404 });
    const isChannelOwner = hasVerifiedIdentity && (channel as any).owner_uid === verifiedUserId;

    if ((channel as any).passcode && !isChannelOwner) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
      const decoded = await verifyRoomToken(roomToken, env);
      if (!decoded || decoded.channel_id !== editParent || decoded.passcode_hash !== (channel as any).passcode) {
        return Response.json({ error: "invalid token" }, { status: 403 });
      }
    }

    const isTargetFrozen = isLiveChannel
      ? (channel as any).target_is_frozen
      : (channel as any).is_frozen;
    if (isTargetFrozen && !isChannelOwner) {
      return Response.json({ error: "channel frozen" }, { status: 403 });
    }

    if (!checkRateLimit(uid as string)) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }

    if (!checkMessageLength(text)) {
      return Response.json({ error: "message_too_long" }, { status: 400 });
    }

    const requesterUid = isChannelOwner ? verifiedUserId! : uid as string;

    const [blocked, allowedByBannedWords] = await Promise.all([
      env.DB.prepare("SELECT 1 FROM blocked WHERE (uid = ? OR fingerprint = ?) AND channel_id = ?")
        .bind(requesterUid, fingerprint || "", editParent).first(),
      checkBannedWords(text, editParent, env),
    ]);
    if (blocked) return Response.json({ error: "blocked" }, { status: 403 });
    if (!allowedByBannedWords) {
      return Response.json({ error: "banned_word" }, { status: 403 });
    }

    // Verify ownership
    const msg = await env.DB.prepare("SELECT uid FROM messages WHERE id = ? AND channel_id = ?")
      .bind(message_id, channel_id).first();
    if (!msg) return Response.json({ error: "not found" }, { status: 404 });
    if (msg.uid !== requesterUid) return Response.json({ error: "not owner" }, { status: 403 });

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

    // Passcode gate
    const patchParent = (channel_id as string).endsWith("_live") ? (channel_id as string).replace(/_live$/, "") : channel_id as string;
    const internalToken = request.headers.get("X-Internal-Token");
    const verifiedUserId = request.headers.get("X-User-Id");
    const isVerifiedAdmin = internalToken === env.INTERNAL_SECRET && !!verifiedUserId;
    if (isVerifiedAdmin) {
      const channel = await env.DB.prepare("SELECT owner_uid FROM channels WHERE id = ?")
        .bind(patchParent).first();
      if (!channel || channel.owner_uid !== verifiedUserId) {
        return Response.json({ error: "not owner" }, { status: 403 });
      }
    }
    const { passcode: patchPasscode } = await getChannelPasscodeInfo(patchParent, env);
    if (patchPasscode && !isVerifiedAdmin) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
      const decoded = await verifyRoomToken(roomToken, env);
      if (!decoded || decoded.channel_id !== patchParent || decoded.passcode_hash !== patchPasscode) {
        return Response.json({ error: "invalid token" }, { status: 403 });
      }
    }

    // Get current reactions
    const msg = await env.DB.prepare("SELECT reactions FROM messages WHERE id = ? AND channel_id = ?")
      .bind(message_id, channel_id).first() as { reactions: string } | null;
    if (!msg) return Response.json({ error: "not found" }, { status: 404 });

    const reactions: Record<string, string> = JSON.parse(msg.reactions || "{}");
    const reactionUid = isVerifiedAdmin ? verifiedUserId! : uid as string;
    const key = `${reactionUid}_${(emoji as string).codePointAt(0)?.toString(16)}`;

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
