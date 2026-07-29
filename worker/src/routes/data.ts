import { Env } from "../types";
import { isReportsChannel, isReportsChannelOwner } from "../lib/special-channels";
import { hydrateReportInboxMessages } from "./channel-reports";
import { authorizeRoomToken } from "./passcode";
import { getChannelPasscodeInfo } from "../lib/validation";

export async function handleData(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const channelId = url.searchParams.get("channel");

  if (!channelId) {
    return Response.json({ error: "missing channel" }, { status: 400 });
  }

  // Passcode gate for data endpoints
  const parentChannelId = channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
  const { passcode, owner_uid } = await getChannelPasscodeInfo(parentChannelId, env);
  const internalToken = request.headers.get("X-Internal-Token");
  const userId = request.headers.get("X-User-Id");
  const trustedUserId = internalToken === env.INTERNAL_SECRET && userId ? userId : "";
  const isOwner = trustedUserId === owner_uid;
  const isReportsOwnerViewer = !isOwner && await isReportsChannelOwner(trustedUserId, env);
  if (isReportsChannel(parentChannelId, env) && !isOwner) {
    return Response.json({ error: "owner access required" }, { status: 403 });
  }

  if (passcode) {
    if (!isOwner && !isReportsOwnerViewer) {
      const roomToken = request.headers.get("X-Room-Token");
      if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
      const decoded = await authorizeRoomToken(roomToken, parentChannelId, passcode, env);
      if (!decoded) {
        return Response.json({ error: "invalid token" }, { status: 403 });
      }
    }
  }

  // These collections expose moderation rules or private user content.
  // Enforce ownership at the data boundary instead of relying on UI hiding.
  if (type === "blocked" || type === "dm" || type === "banned-words") {
    if (!isOwner) {
      return Response.json({ error: "owner access required" }, { status: 403 });
    }
  }

  switch (type) {
    case "messages": {
      const cursor = url.searchParams.get("cursor");
      const cursorId = url.searchParams.get("cursor_id");
      const direction = url.searchParams.get("direction");
      const limit = 50;

      let innerQuery = "SELECT * FROM messages WHERE channel_id = ? AND (deleted = 0 OR (deleted = 1 AND id IN (SELECT reply_to FROM messages WHERE channel_id = ? AND deleted = 0 AND reply_to IS NOT NULL)))";
      const params: unknown[] = [channelId, channelId];

      if (cursor) {
        if (direction === "after") {
          innerQuery += cursorId
            ? " AND (created_at > ? OR (created_at = ? AND id > ?))"
            : " AND created_at > ?";
          params.push(cursor, ...(cursorId ? [cursor, cursorId] : []));
        } else {
          innerQuery += cursorId
            ? " AND (created_at < ? OR (created_at = ? AND id < ?))"
            : " AND created_at < ?";
          params.push(cursor, ...(cursorId ? [cursor, cursorId] : []));
        }
      }

      innerQuery += direction === "after"
        ? " ORDER BY created_at ASC, id ASC LIMIT ?"
        : " ORDER BY created_at DESC, id DESC LIMIT ?";
      params.push(limit);

      const query = `SELECT * FROM (${innerQuery}) ORDER BY created_at ASC, id ASC`;
      const stmt = env.DB.prepare(query);
      const { results } = await stmt.bind(...params).all();
      const messages = isReportsChannel(parentChannelId, env) && isOwner
        ? await hydrateReportInboxMessages((results || []) as Array<{ id: string }>, env)
        : results;
      return Response.json({ messages });
    }

    case "message-context": {
      const messageId = url.searchParams.get("message_id");
      if (!messageId) {
        return Response.json({ error: "missing message id" }, { status: 400 });
      }

      const target = await env.DB.prepare(
        "SELECT id, created_at, reply_to FROM messages WHERE id = ? AND channel_id = ? AND deleted = 0"
      ).bind(messageId, channelId).first<{ id: string; created_at: string; reply_to: string | null }>();
      if (!target) {
        return Response.json({ error: "message not found" }, { status: 404 });
      }

      const visibleMessageCondition = `
        channel_id = ?
        AND (
          deleted = 0
          OR (
            deleted = 1
            AND id IN (
              SELECT reply_to FROM messages
              WHERE channel_id = ? AND deleted = 0 AND reply_to IS NOT NULL
            )
          )
        )
      `;
      const [beforeResult, afterResult, parentResult] = await Promise.all([
        env.DB.prepare(`
          SELECT * FROM messages
          WHERE ${visibleMessageCondition}
            AND (created_at < ? OR (created_at = ? AND id <= ?))
          ORDER BY created_at DESC, id DESC
          LIMIT 27
        `).bind(channelId, channelId, target.created_at, target.created_at, target.id).all(),
        env.DB.prepare(`
          SELECT * FROM messages
          WHERE ${visibleMessageCondition}
            AND (created_at > ? OR (created_at = ? AND id > ?))
          ORDER BY created_at ASC, id ASC
          LIMIT 26
        `).bind(channelId, channelId, target.created_at, target.created_at, target.id).all(),
        target.reply_to
          ? env.DB.prepare(`
              SELECT * FROM messages
              WHERE id = ? AND channel_id = ?
                AND (
                  deleted = 0
                  OR id IN (
                    SELECT reply_to FROM messages
                    WHERE channel_id = ? AND deleted = 0 AND reply_to IS NOT NULL
                  )
                )
              LIMIT 1
            `).bind(target.reply_to, channelId, channelId).all()
          : Promise.resolve({ results: [] }),
      ]);

      const hasOlder = beforeResult.results.length > 26;
      const hasNewer = afterResult.results.length > 25;
      const beforeMessages = beforeResult.results.slice(0, 26);
      const afterMessages = afterResult.results.slice(0, 25);
      const byId = new Map<string, Record<string, unknown>>();
      for (const message of [
        ...beforeMessages,
        ...afterMessages,
        ...parentResult.results,
      ] as Record<string, unknown>[]) {
        byId.set(String(message.id), message);
      }
      const messages = [...byId.values()].sort((left, right) =>
        String(left.created_at || "").localeCompare(String(right.created_at || ""))
      );
      const responseMessages = isReportsChannel(parentChannelId, env) && isOwner
        ? await hydrateReportInboxMessages(messages as Array<{ id: string }>, env)
        : messages;
      return Response.json({
        messages: responseMessages,
        target_id: target.id,
        has_older: hasOlder,
        has_newer: hasNewer,
      });
    }

    case "blocked": {
      const { results } = await env.DB.prepare("SELECT * FROM blocked WHERE channel_id = ?")
        .bind(channelId).all();
      return Response.json({ blocked: results });
    }

    case "gallery": {
      const cursor = url.searchParams.get("cursor");
      let query = `
        SELECT g.*
        FROM gallery g
        INNER JOIN messages m ON m.id = g.id AND m.channel_id = g.channel_id
        WHERE g.channel_id = ? AND m.deleted = 0
      `;
      const params: unknown[] = [channelId];
      if (cursor) {
        query += " AND g.created_at < ?";
        params.push(cursor);
      }
      query += " ORDER BY g.created_at DESC, g.id DESC LIMIT 50";
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return Response.json({ gallery: results });
    }

    case "dm": {
      const { results } = await env.DB.prepare(
        "SELECT * FROM dm WHERE channel_id = ? ORDER BY created_at DESC LIMIT 100"
      ).bind(channelId).all();
      return Response.json({ dm: results });
    }

    case "links": {
      const cursor = url.searchParams.get("cursor");
      let query = "SELECT id, text, created_at FROM messages WHERE channel_id = ? AND deleted = 0 AND (text LIKE '%http://%' OR text LIKE '%https://%' OR text LIKE '%www.%')";
      const params: unknown[] = [channelId];
      if (cursor) {
        query += " AND created_at < ?";
        params.push(cursor);
      }
      query += " ORDER BY created_at DESC LIMIT 30";
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return Response.json({ links: results });
    }

    case "search": {
      const query = url.searchParams.get("q");
      if (!query) return Response.json({ results: [] });
      const { results } = await env.DB.prepare(
        "SELECT m.* FROM messages m JOIN messages_fts ON m.rowid = messages_fts.rowid WHERE messages_fts.text MATCH ? AND m.channel_id = ? AND m.deleted = 0 ORDER BY m.created_at DESC LIMIT 30"
      ).bind(query, channelId).all();
      return Response.json({ results });
    }

    case "banned-words": {
      const { results } = await env.DB.prepare(
        "SELECT * FROM banned_words WHERE channel_id = ? AND (expires IS NULL OR expires > datetime('now'))"
      ).bind(channelId).all();
      return Response.json({ bannedWords: results });
    }

    default:
      return Response.json({ error: "unknown type" }, { status: 400 });
  }
}
