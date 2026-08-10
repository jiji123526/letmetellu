import { Env } from "../types";
import { getUserLocale } from "../lib/channel-moderation";
import {
  readVisibleFlatThreads,
  readVisibleMessagePage,
  type VisibleMessageRow,
  VISIBLE_MESSAGE_CONDITION,
} from "../lib/visible-messages";
import { isReportsChannel, isReportsChannelOwner } from "../lib/special-channels";
import { hydrateReportInboxMessages } from "./channel-reports";
import { authorizeRoomToken } from "./passcode";
import { getChannelPasscodeInfo } from "../lib/validation";
import { normalizeMessageSearchQuery } from "../lib/message-search";

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
  const reportsOwnerLocale = isOwner && trustedUserId
    ? await getUserLocale(trustedUserId, env)
    : "ko";
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
      const direction = url.searchParams.get("direction") as "before" | "after" | null;
      const { messages: expandedResults, hasMore } = await readVisibleMessagePage(env, channelId, {
        cursor,
        cursorId,
        direction,
        limit: 50,
      });
      const messages = isReportsChannel(parentChannelId, env) && isOwner
        ? await hydrateReportInboxMessages(expandedResults as Array<{ id: string }>, env, reportsOwnerLocale)
        : expandedResults;
      return Response.json({ messages, has_more: hasMore });
    }

    case "message-context": {
      const messageId = url.searchParams.get("message_id");
      if (!messageId) {
        return Response.json({ error: "missing message id" }, { status: 400 });
      }

      const target = await env.DB.prepare(
        `SELECT id, created_at, reply_to
         FROM messages
         WHERE id = ? AND channel_id = ?
           AND (
             deleted = 0
             OR (
               deleted = 1
               AND EXISTS (
                 SELECT 1 FROM messages child
                 WHERE child.channel_id = ?
                   AND child.reply_to = messages.id
                   AND child.deleted = 0
               )
             )
           )`
      ).bind(messageId, channelId, channelId).first<{ id: string; created_at: string; reply_to: string | null }>();
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
      const threadRootId = target.reply_to || target.id;

      const [beforeResult, afterResult, threadMessages] = await Promise.all([
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
        readVisibleFlatThreads(env, channelId, [threadRootId]),
      ]);

      const hasOlder = beforeResult.results.length > 26;
      const hasNewer = afterResult.results.length > 25;
      const beforeMessages = beforeResult.results.slice(0, 26);
      const afterMessages = afterResult.results.slice(0, 25);
      const byId = new Map<string, Record<string, unknown>>();
      for (const message of [
        ...beforeMessages,
        ...afterMessages,
        ...threadMessages,
      ] as Record<string, unknown>[]) {
        byId.set(String(message.id), message);
      }
      const messages = [...byId.values()].sort((left, right) =>
        String(left.created_at || "").localeCompare(String(right.created_at || ""))
      );
      const responseMessages = isReportsChannel(parentChannelId, env) && isOwner
        ? await hydrateReportInboxMessages(messages as Array<{ id: string }>, env, reportsOwnerLocale)
        : messages;
      return Response.json({
        messages: responseMessages,
        target_id: target.id,
        has_older: hasOlder,
        has_newer: hasNewer,
      });
    }

    case "reply-parents": {
      const parentIds = [...new Set(
        url.searchParams
          .getAll("parent_id")
          .map((parentId) => parentId.trim())
          .filter(Boolean),
      )].slice(0, 20);
      if (parentIds.length === 0) {
        return Response.json({ error: "missing parent ids" }, { status: 400 });
      }

      const placeholders = parentIds.map(() => "?").join(", ");
      const parentResult = await env.DB.prepare(`
        SELECT * FROM messages
        WHERE id IN (${placeholders})
          AND ${VISIBLE_MESSAGE_CONDITION}
        ORDER BY created_at ASC, id ASC
      `).bind(...parentIds, channelId, channelId).all<VisibleMessageRow>();

      const foundMessages = parentResult.results || [];
      const foundIds = new Set(foundMessages.map((message) => String(message.id)));
      const responseMessages = isReportsChannel(parentChannelId, env) && isOwner
        ? await hydrateReportInboxMessages(foundMessages as Array<{ id: string }>, env, reportsOwnerLocale)
        : foundMessages;

      return Response.json({
        messages: responseMessages,
        missing_ids: parentIds.filter((parentId) => !foundIds.has(parentId)),
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
        SELECT
          m.id AS id,
          g.image,
          g.auth_uid,
          g.channel_id,
          g.created_at
        FROM gallery g
        INNER JOIN messages m ON m.gallery_id = g.id AND m.channel_id = g.channel_id
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
      let query = `
        SELECT m.id, m.text, ml.created_at
        FROM message_links ml
        INNER JOIN messages m ON m.id = ml.message_id
        WHERE ml.channel_id = ? AND m.deleted = 0
      `;
      const params: unknown[] = [channelId];
      if (cursor) {
        query += " AND ml.created_at < ?";
        params.push(cursor);
      }
      query += " ORDER BY ml.created_at DESC, ml.message_id DESC LIMIT 30";
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return Response.json({ links: results });
    }

    case "search": {
      const query = normalizeMessageSearchQuery(url.searchParams.get("q") || "");
      if (!query) {
        return Response.json({ results: [], has_more: false, next_cursor: null });
      }

      const cursor = url.searchParams.get("cursor");
      const cursorId = url.searchParams.get("cursor_id");
      const limit = 30;
      let searchQuery = `
        SELECT m.id, m.text, m.created_at
        FROM messages m
        WHERE m.channel_id = ?
          AND m.deleted = 0
          AND instr(lower(COALESCE(m.text, '')), lower(?)) > 0
      `;
      const params: unknown[] = [channelId, query];
      if (cursor && cursorId) {
        searchQuery += " AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))";
        params.push(cursor, cursor, cursorId);
      }
      searchQuery += " ORDER BY m.created_at DESC, m.id DESC LIMIT ?";
      params.push(limit + 1);

      const { results } = await env.DB.prepare(searchQuery).bind(...params).all();
      const page = results.slice(0, limit);
      const hasMore = results.length > limit;
      const last = page.at(-1) as { id?: unknown; created_at?: unknown } | undefined;
      return Response.json({
        results: page,
        has_more: hasMore,
        next_cursor: hasMore && last
          ? { created_at: String(last.created_at || ""), id: String(last.id || "") }
          : null,
      });
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
