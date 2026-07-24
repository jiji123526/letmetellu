import { Env } from "../types";

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  // Verify internal token (sent by Vercel after session check)
  const token = request.headers.get("X-Internal-Token");
  if (token !== env.INTERNAL_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = request.headers.get("X-User-Id");
  if (!userId) {
    return Response.json({ error: "missing user id" }, { status: 400 });
  }

  const body = await request.json() as { action: string; channel_id: string; payload?: Record<string, unknown> };
  const { action, channel_id, payload } = body;

  // Skip ownership check for create-channel (channel doesn't exist yet)
  if (action !== "create-channel") {
    const channel = await env.DB.prepare("SELECT owner_uid FROM channels WHERE id = ?")
      .bind(channel_id).first();
    if (!channel || channel.owner_uid !== userId) {
      return Response.json({ error: "not owner" }, { status: 403 });
    }
  }

  switch (action) {
    case "create-channel": {
      const { name } = payload || {};
      // channel_id is the slug, userId is the owner
      const existing = await env.DB.prepare("SELECT id FROM channels WHERE id = ?").bind(channel_id).first();
      if (existing) return Response.json({ error: "channel already exists" }, { status: 409 });

      await env.DB.prepare(
        "INSERT INTO channels (id, owner_uid, name) VALUES (?, ?, ?)"
      ).bind(channel_id, userId, name || "My Channel").run();

      return Response.json({ ok: true, channel_id });
    }

    case "freeze": {
      const frozen = payload?.frozen ? 1 : 0;
      await env.DB.prepare("UPDATE channels SET is_frozen = ? WHERE id = ?")
        .bind(frozen, channel_id).run();

      // Broadcast freeze change
      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "freeze-change", frozen: !!payload?.frozen }),
      }));

      return Response.json({ ok: true });
    }

    case "block": {
      const { uid, reason, fingerprint } = payload || {};
      await env.DB.prepare(
        "INSERT INTO blocked (id, uid, reason, fingerprint, channel_id) VALUES (?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), uid, reason || "", fingerprint || null, channel_id).run();
      return Response.json({ ok: true });
    }

    case "unblock": {
      const { uid: unblockUid } = payload || {};
      await env.DB.prepare("DELETE FROM blocked WHERE uid = ? AND channel_id = ?")
        .bind(unblockUid, channel_id).run();
      // Clean up old petition DMs from this user
      await env.DB.prepare("DELETE FROM dm WHERE uid = ? AND channel_id = ? AND text LIKE '[이의 제기]%'")
        .bind(unblockUid, channel_id).run();
      // Clean up old report messages about this user
      await env.DB.prepare("DELETE FROM messages WHERE uid = ? AND channel_id = ? AND report = 1")
        .bind(unblockUid, channel_id).run();

      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "message-changed", channel_id }),
      }));

      return Response.json({ ok: true });
    }

    case "delete-message": {
      const { message_id } = payload || {};
      await env.DB.prepare("UPDATE messages SET deleted = 1 WHERE id = ? AND channel_id = ?")
        .bind(message_id, channel_id).run();

      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "message-changed", channel_id }),
      }));

      return Response.json({ ok: true });
    }

    case "delete-dm": {
      const { dm_id } = payload || {};
      await env.DB.prepare("DELETE FROM dm WHERE id = ? AND channel_id = ?")
        .bind(dm_id, channel_id).run();

      const doId2 = env.CHAT_ROOM.idFromName(channel_id);
      const stub2 = env.CHAT_ROOM.get(doId2);
      await stub2.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "dm-changed", channel_id }),
      }));

      return Response.json({ ok: true });
    }

    case "update-profile": {
      const { name, profile_image, bubble_color } = payload || {};
      const updates: string[] = [];
      const values: unknown[] = [];

      if (name !== undefined) { updates.push("name = ?"); values.push(name); }
      if (profile_image !== undefined) { updates.push("profile_image = ?"); values.push(profile_image); }
      if (bubble_color !== undefined) { updates.push("bubble_color = ?"); values.push(bubble_color); }

      if (updates.length > 0) {
        values.push(channel_id);
        await env.DB.prepare(`UPDATE channels SET ${updates.join(", ")} WHERE id = ?`)
          .bind(...values).run();

        const doId = env.CHAT_ROOM.idFromName(channel_id);
        const stub = env.CHAT_ROOM.get(doId);
        await stub.fetch(new Request("http://internal/broadcast", {
          method: "POST",
          body: JSON.stringify({ type: "profile-change", channel_id }),
        }));
      }

      return Response.json({ ok: true });
    }

    case "set-notice": {
      const { text } = payload || {};
      const noticeText = (text as string) || "";
      // Upsert into config table
      await env.DB.prepare(
        "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
      ).bind(`notice_${channel_id}`, noticeText, channel_id, noticeText).run();

      // Broadcast notice change
      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "notice-changed", channel_id, notice: noticeText }),
      }));

      return Response.json({ ok: true });
    }

    case "set-rules": {
      const { rules } = payload || {};
      const rulesText = (rules as string) || "[]";
      await env.DB.prepare("UPDATE channels SET notice = ? WHERE id = ?")
        .bind(rulesText, channel_id).run();

      return Response.json({ ok: true });
    }

    case "add-banned-word": {
      const { word, expires } = payload || {};
      if (!word) return Response.json({ error: "missing word" }, { status: 400 });
      await env.DB.prepare(
        "INSERT INTO banned_words (id, word, channel_id, expires) VALUES (?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), word, channel_id, expires || null).run();
      return Response.json({ ok: true });
    }

    case "remove-banned-word": {
      const { word } = payload || {};
      if (!word) return Response.json({ error: "missing word" }, { status: 400 });
      await env.DB.prepare("DELETE FROM banned_words WHERE word = ? AND channel_id = ?")
        .bind(word, channel_id).run();
      return Response.json({ ok: true });
    }

    case "set-welcome": {
      const { config } = payload || {};
      await env.DB.prepare(
        "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
      ).bind(`welcome_${channel_id}`, config || "", channel_id, config || "").run();
      return Response.json({ ok: true });
    }

    case "set-emoji-presets": {
      const { emojis } = payload || {};
      await env.DB.prepare(
        "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
      ).bind(`liveEmojis_${channel_id}`, emojis || "[]", channel_id, emojis || "[]").run();

      // Broadcast preset change so other clients update their emoji bar
      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "emoji-presets-changed", emojis: emojis || "[]" }),
      }));

      return Response.json({ ok: true });
    }

    case "start-live": {
      const { title } = payload || {};
      const sessionId = crypto.randomUUID();
      const liveState = JSON.stringify({ active: true, title: title || "라이브 채팅", sessionId });

      await env.DB.prepare(
        "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
      ).bind(`live_${channel_id}`, liveState, channel_id, liveState).run();

      // Create a temporary channel entry for the _live channel (FK constraint)
      const liveChannelId = `${channel_id}_live`;
      await env.DB.prepare(
        "INSERT OR IGNORE INTO channels (id, owner_uid, name) VALUES (?, ?, ?)"
      ).bind(liveChannelId, userId, "Live").run();

      // Broadcast live-started to all connected clients
      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "live-started", channel_id, title: title || "라이브 채팅", sessionId }),
      }));

      return Response.json({ ok: true, sessionId });
    }

    case "end-live": {
      const liveChannelId = `${channel_id}_live`;

      // Mark live as inactive
      await env.DB.prepare(
        "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
      ).bind(`live_${channel_id}`, "false", channel_id, "false").run();

      // Broadcast live-ended BEFORE cleanup so clients exit live mode
      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "live-ended", channel_id }),
      }));

      // Collect R2 media keys from live messages before deleting
      const { results: liveMedia } = await env.DB.prepare(
        "SELECT image FROM messages WHERE channel_id = ? AND image IS NOT NULL"
      ).bind(liveChannelId).all();
      const { results: liveGalleryMedia } = await env.DB.prepare(
        "SELECT image FROM gallery WHERE channel_id = ? AND image IS NOT NULL"
      ).bind(liveChannelId).all();
      const { results: liveDmMedia } = await env.DB.prepare(
        "SELECT image FROM dm WHERE channel_id = ? AND image IS NOT NULL"
      ).bind(liveChannelId).all();

      // Delete R2 objects for live media
      const allMedia = [...(liveMedia || []), ...(liveGalleryMedia || []), ...(liveDmMedia || [])];
      for (const row of allMedia) {
        if (row.image) {
          // Extract key from URL (format: .../api/media/KEY)
          const key = (row.image as string).split("/api/media/").pop();
          if (key) {
            try { await env.MEDIA.delete(key); } catch {}
          }
        }
      }

      // Delete all live channel data
      await env.DB.prepare("DELETE FROM messages WHERE channel_id = ?").bind(liveChannelId).run();
      await env.DB.prepare("DELETE FROM gallery WHERE channel_id = ?").bind(liveChannelId).run();
      await env.DB.prepare("DELETE FROM dm WHERE channel_id = ?").bind(liveChannelId).run();
      await env.DB.prepare("DELETE FROM blocked WHERE channel_id = ?").bind(liveChannelId).run();
      await env.DB.prepare("DELETE FROM config WHERE channel_id = ?").bind(liveChannelId).run();
      // Remove the temporary live channel entry
      await env.DB.prepare("DELETE FROM channels WHERE id = ?").bind(liveChannelId).run();

      return Response.json({ ok: true });
    }

    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
}
