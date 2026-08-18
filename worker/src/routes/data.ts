import { Env } from "../types";
import { getUserLocale } from "../lib/channel-moderation";
import {
  expandVisibleRootThreads,
  readVisibleMessagePage,
  type VisibleMessageRow,
  VISIBLE_MESSAGE_CONDITION,
  VISIBLE_ROOT_MESSAGE_CONDITION,
} from "../lib/visible-messages";
import { isReportsChannel, isReportsChannelOwner } from "../lib/special-channels";
import { hydrateReportInboxMessages } from "./channel-reports";
import { authorizeRoomToken } from "./passcode";
import { getChannelPasscodeInfo } from "../lib/validation";
import {
  normalizeMessageSearchQuery,
  shouldUseTrigramMessageSearch,
  toFts5Phrase,
} from "../lib/message-search";
import { getTrustedUserId } from "../lib/trusted-identity";
import { readDmThreads } from "../lib/dm-threads";
import { recordOperationalEvent } from "../lib/operational-events";
import { readUnifiedTimelinePage } from "../lib/unified-timeline-reader";
import { compareUnifiedTimelineShadow } from "../lib/unified-timeline-shadow";
import { resolveUnifiedTimelineViewer } from "../lib/unified-timeline-viewer";
import {
  createUnifiedTimelineMetricRecord,
  logUnifiedTimelineMetric,
} from "../lib/unified-timeline-metrics";

export async function handleData(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const channelId = url.searchParams.get("channel");

  if (!channelId) {
    return Response.json({ error: "missing channel" }, { status: 400 });
  }

  // Passcode gate for data endpoints
  const parentChannelId = channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
  const { exists, passcode, owner_uid } = await getChannelPasscodeInfo(parentChannelId, env);
  if (!exists) {
    return Response.json({ error: "channel not found" }, { status: 404 });
  }
  const trustedUserId = getTrustedUserId(request, env) || "";
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
      const {
        messages: expandedResults,
        hasMore,
        pageStartCursor,
        pageEndCursor,
      } = await readVisibleMessagePage(env, channelId, {
        cursor,
        cursorId,
        direction,
        limit: 50,
      });
      const messages = isReportsChannel(parentChannelId, env) && isOwner
        ? await hydrateReportInboxMessages(expandedResults as Array<{ id: string }>, env, reportsOwnerLocale)
        : expandedResults;
      const responsePayload = {
        messages,
        has_more: hasMore,
        page_start_cursor: pageStartCursor
          ? { id: pageStartCursor.id, created_at: pageStartCursor.createdAt }
          : null,
        page_end_cursor: pageEndCursor
          ? { id: pageEndCursor.id, created_at: pageEndCursor.createdAt }
          : null,
      };
      const shadowRequested = request.headers.get("X-Unified-Timeline-Shadow") === "1";
      const shadowEligible = shadowRequested
        && !cursor
        && !cursorId
        && !direction
        && !channelId.endsWith("_live")
        && !isReportsChannel(parentChannelId, env);
      if (!shadowEligible) {
        return Response.json(responsePayload, shadowRequested
          ? { headers: { "X-Unified-Timeline-Shadow": "skipped" } }
          : undefined);
      }

      const viewer = await resolveUnifiedTimelineViewer(request, env, isOwner);
      if (!viewer) {
        return Response.json(responsePayload, {
          headers: { "X-Unified-Timeline-Shadow": "identity-required" },
        });
      }

      try {
        const readMeasuredUnifiedPage = async () => {
          const startedAt = performance.now();
          const page = await readUnifiedTimelinePage(env, channelId, viewer, { limit: 50 });
          logUnifiedTimelineMetric(createUnifiedTimelineMetricRecord({
            metrics: page.metrics,
            owner: viewer.owner,
            readMode: "page",
            rolloutMode: "shadow",
            workerDurationMs: performance.now() - startedAt,
          }));
          return page;
        };
        const [dmMessages, unifiedPage] = await Promise.all([
          readDmThreads(env, channelId, viewer),
          readMeasuredUnifiedPage(),
        ]);
        const comparison = compareUnifiedTimelineShadow({
          publicMessages: expandedResults,
          dmMessages,
          unifiedPage,
          limit: 50,
        });
        if (!comparison.matches) {
          await recordOperationalEvent({
            env,
            severity: "warn",
            route: "GET /api/data",
            eventType: "unified_timeline_shadow_mismatch",
            statusCode: 200,
            actorUserId: isOwner ? trustedUserId : null,
            targetId: parentChannelId,
            detail: {
              legacy_root_count: comparison.legacyRootCount,
              unified_root_count: comparison.unifiedRootCount,
              first_mismatch_index: comparison.firstMismatchIndex,
              legacy_source_at_mismatch: comparison.legacySourceAtMismatch,
              unified_source_at_mismatch: comparison.unifiedSourceAtMismatch,
            },
          });
        }
        return Response.json(responsePayload, {
          headers: {
            "X-Unified-Timeline-Shadow": comparison.matches ? "match" : "mismatch",
          },
        });
      } catch (error) {
        await recordOperationalEvent({
          env,
          severity: "warn",
          route: "GET /api/data",
          eventType: "unified_timeline_shadow_failed",
          statusCode: 200,
          actorUserId: isOwner ? trustedUserId : null,
          targetId: parentChannelId,
          detail: {
            error_name: error instanceof Error ? error.name : "unknown",
          },
        });
        return Response.json(responsePayload, {
          headers: { "X-Unified-Timeline-Shadow": "failed" },
        });
      }
    }

    case "message-context": {
      const messageId = url.searchParams.get("message_id");
      if (!messageId) {
        return Response.json({ error: "missing message id" }, { status: 400 });
      }

      const target = await env.DB.prepare(
        `WITH RECURSIVE ancestors(id, created_at, reply_to) AS (
           SELECT id, created_at, reply_to
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
             )
           UNION
           SELECT parent.id, parent.created_at, parent.reply_to
           FROM messages parent
           INNER JOIN ancestors ON ancestors.reply_to = parent.id
           WHERE parent.channel_id = ?
         )
         SELECT
           id AS thread_root_id,
           created_at AS thread_root_created_at
         FROM ancestors
         WHERE reply_to IS NULL
         LIMIT 1`
      ).bind(messageId, channelId, channelId, channelId).first<{
        thread_root_id: string;
        thread_root_created_at: string;
      }>();
      if (!target) {
        return Response.json({ error: "message not found" }, { status: 404 });
      }

      const [beforeResult, afterResult] = await Promise.all([
        env.DB.prepare(`
          SELECT * FROM messages
          WHERE ${VISIBLE_ROOT_MESSAGE_CONDITION}
            AND (created_at, id) <= (?, ?)
          ORDER BY created_at DESC, id DESC
          LIMIT 27
        `).bind(
          channelId,
          channelId,
          target.thread_root_created_at,
          target.thread_root_id,
        ).all<VisibleMessageRow>(),
        env.DB.prepare(`
          SELECT * FROM messages
          WHERE ${VISIBLE_ROOT_MESSAGE_CONDITION}
            AND (created_at, id) > (?, ?)
          ORDER BY created_at ASC, id ASC
          LIMIT 26
        `).bind(
          channelId,
          channelId,
          target.thread_root_created_at,
          target.thread_root_id,
        ).all<VisibleMessageRow>(),
      ]);

      const hasOlder = beforeResult.results.length > 26;
      const hasNewer = afterResult.results.length > 25;
      const beforeMessages = beforeResult.results.slice(0, 26);
      const afterMessages = afterResult.results.slice(0, 25);
      const contextPageRows = [...beforeMessages, ...afterMessages].sort((left, right) =>
        String(left.created_at || "").localeCompare(String(right.created_at || ""))
        || String(left.id || "").localeCompare(String(right.id || ""))
      );
      const pageStart = contextPageRows[0] as { id?: string; created_at?: string } | undefined;
      const pageEnd = contextPageRows.at(-1) as { id?: string; created_at?: string } | undefined;
      const messages = await expandVisibleRootThreads(env, channelId, contextPageRows);
      const responseMessages = isReportsChannel(parentChannelId, env) && isOwner
        ? await hydrateReportInboxMessages(messages as Array<{ id: string }>, env, reportsOwnerLocale)
        : messages;
      return Response.json({
        messages: responseMessages,
        target_id: messageId,
        has_older: hasOlder,
        has_newer: hasNewer,
        page_start_cursor: pageStart?.id && pageStart.created_at
          ? { id: pageStart.id, created_at: pageStart.created_at }
          : null,
        page_end_cursor: pageEnd?.id && pageEnd.created_at
          ? { id: pageEnd.id, created_at: pageEnd.created_at }
          : null,
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
      const cursorId = url.searchParams.get("cursor_id");
      // CROSS JOIN keeps the ordered gallery index as the outer loop.
      let query = `
        SELECT
          m.id AS id,
          g.image,
          g.auth_uid,
          g.channel_id,
          g.created_at
        FROM gallery g
        CROSS JOIN messages m
        WHERE g.channel_id = ?
          AND m.channel_id = g.channel_id
          AND m.gallery_id = g.id
          AND m.deleted = 0
      `;
      const params: unknown[] = [channelId];
      if (cursor && cursorId) {
        query += " AND (g.created_at < ? OR (g.created_at = ? AND g.id < ?))";
        params.push(cursor, cursor, cursorId);
      } else if (cursor) {
        query += " AND g.created_at < ?";
        params.push(cursor);
      }
      query += " ORDER BY g.created_at DESC, g.id DESC LIMIT 50";
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return Response.json({ gallery: results });
    }

    case "dm": {
      const { results } = await env.DB.prepare(
        "SELECT * FROM dm WHERE channel_id = ? AND pending_delete_at IS NULL ORDER BY created_at DESC LIMIT 100"
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

      const cursorCreatedAt = url.searchParams.get("cursor");
      const cursorId = url.searchParams.get("cursor_id");
      let cursorRootCreatedAt = url.searchParams.get("cursor_root_created_at");
      let cursorRootId = url.searchParams.get("cursor_root_id");
      let cursorDepth = Number.parseInt(url.searchParams.get("cursor_depth") || "", 10);
      const limit = 30;
      const useTrigram = shouldUseTrigramMessageSearch(query);
      if (
        cursorCreatedAt
        && cursorId
        && (!cursorRootCreatedAt || !cursorRootId || !Number.isInteger(cursorDepth))
      ) {
        const legacyCursor = await env.DB.prepare(`
          SELECT
            COALESCE(root.created_at, m.created_at) AS visual_root_created_at,
            COALESCE(root.id, m.id) AS visual_root_id,
            CASE WHEN m.reply_to IS NULL THEN 0 ELSE 1 END AS visual_depth
          FROM messages m
          LEFT JOIN messages root
            ON root.id = m.reply_to AND root.channel_id = m.channel_id
          WHERE m.id = ? AND m.channel_id = ?
          LIMIT 1
        `).bind(cursorId, channelId).first<{
          visual_root_created_at: string;
          visual_root_id: string;
          visual_depth: number;
        }>();
        cursorRootCreatedAt = legacyCursor?.visual_root_created_at || null;
        cursorRootId = legacyCursor?.visual_root_id || null;
        cursorDepth = legacyCursor?.visual_depth ?? Number.NaN;
      }

      let searchQuery = useTrigram
        ? `
          WITH search_matches AS (
            SELECT
              m.id,
              m.text,
              m.created_at,
              m.reply_to,
              COALESCE(root.created_at, m.created_at) AS visual_root_created_at,
              COALESCE(root.id, m.id) AS visual_root_id,
              CASE WHEN m.reply_to IS NULL THEN 0 ELSE 1 END AS visual_depth
            FROM messages_fts
            INNER JOIN messages m ON m.rowid = messages_fts.rowid
            LEFT JOIN messages root
              ON root.id = m.reply_to AND root.channel_id = m.channel_id
            WHERE messages_fts MATCH ?
              AND m.channel_id = ?
              AND m.deleted = 0
          )
          SELECT *
          FROM search_matches
          WHERE 1 = 1
        `
        : `
          WITH search_matches AS (
            SELECT
              m.id,
              m.text,
              m.created_at,
              m.reply_to,
              COALESCE(root.created_at, m.created_at) AS visual_root_created_at,
              COALESCE(root.id, m.id) AS visual_root_id,
              CASE WHEN m.reply_to IS NULL THEN 0 ELSE 1 END AS visual_depth
            FROM messages m
            LEFT JOIN messages root
              ON root.id = m.reply_to AND root.channel_id = m.channel_id
            WHERE m.channel_id = ?
              AND m.deleted = 0
              AND instr(lower(COALESCE(m.text, '')), lower(?)) > 0
          )
          SELECT *
          FROM search_matches
          WHERE 1 = 1
        `;
      const params: unknown[] = useTrigram
        ? [toFts5Phrase(query), channelId]
        : [channelId, query];
      if (
        cursorCreatedAt
        && cursorId
        && cursorRootCreatedAt
        && cursorRootId
        && Number.isInteger(cursorDepth)
      ) {
        searchQuery += `
          AND (
            visual_root_created_at < ?
            OR (visual_root_created_at = ? AND visual_root_id < ?)
            OR (visual_root_created_at = ? AND visual_root_id = ? AND visual_depth < ?)
            OR (
              visual_root_created_at = ? AND visual_root_id = ? AND visual_depth = ?
              AND created_at < ?
            )
            OR (
              visual_root_created_at = ? AND visual_root_id = ? AND visual_depth = ?
              AND created_at = ? AND id < ?
            )
          )
        `;
        params.push(
          cursorRootCreatedAt,
          cursorRootCreatedAt, cursorRootId,
          cursorRootCreatedAt, cursorRootId, cursorDepth,
          cursorRootCreatedAt, cursorRootId, cursorDepth, cursorCreatedAt,
          cursorRootCreatedAt, cursorRootId, cursorDepth, cursorCreatedAt, cursorId,
        );
      }
      searchQuery += `
        ORDER BY
          visual_root_created_at DESC,
          visual_root_id DESC,
          visual_depth DESC,
          created_at DESC,
          id DESC
        LIMIT ?
      `;
      params.push(limit + 1);

      const { results } = await env.DB.prepare(searchQuery).bind(...params).all();
      const page = results.slice(0, limit);
      const hasMore = results.length > limit;
      const last = page.at(-1) as {
        id?: unknown;
        created_at?: unknown;
        visual_root_created_at?: unknown;
        visual_root_id?: unknown;
        visual_depth?: unknown;
      } | undefined;
      return Response.json({
        results: page,
        has_more: hasMore,
        next_cursor: hasMore && last
          ? {
              visual_root_created_at: String(last.visual_root_created_at || ""),
              visual_root_id: String(last.visual_root_id || ""),
              visual_depth: Number(last.visual_depth || 0),
              created_at: String(last.created_at || ""),
              id: String(last.id || ""),
            }
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
