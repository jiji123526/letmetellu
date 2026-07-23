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

  // Verify ownership
  const channel = await env.DB.prepare("SELECT owner_uid FROM channels WHERE id = ?")
    .bind(channel_id).first();
  if (!channel || channel.owner_uid !== userId) {
    return Response.json({ error: "not owner" }, { status: 403 });
  }

  switch (action) {
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

    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
}
