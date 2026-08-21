import type { Env } from "../types.ts";

export type VisibleMessageRow = Record<string, unknown> & {
  id: string;
  reply_to?: string | null;
  created_at?: string;
};

export interface VisibleMessageCursor {
  id: string;
  createdAt: string;
}

export const VISIBLE_MESSAGE_CONDITION = `
  channel_id = ?
  AND (
    deleted = 0
    OR (
      deleted = 1
      AND EXISTS (
        SELECT 1 FROM messages child
        WHERE child.channel_id = ?
          AND child.deleted = 0
          AND child.reply_to = messages.id
      )
    )
  )
`;

export const VISIBLE_ROOT_MESSAGE_CONDITION = `
  ${VISIBLE_MESSAGE_CONDITION}
  AND reply_to IS NULL
`;

export async function readVisibleTargetRoot(
  env: Env,
  channelId: string,
  targetId: string,
  onResult?: (result: D1Result<VisibleMessageRow>) => void,
): Promise<VisibleMessageRow | null> {
  const result = await env.DB.prepare(`
    SELECT root.*
    FROM messages target
    INNER JOIN messages root
      ON root.id = CASE
        WHEN target.reply_to IS NULL THEN target.id
        ELSE COALESCE(target.root_id, target.reply_to)
      END
      AND root.channel_id = target.channel_id
    WHERE target.channel_id = ?
      AND target.id = ?
      AND (
        target.deleted = 0
        OR (
          target.deleted = 1
          AND EXISTS (
            SELECT 1
            FROM messages target_child
            WHERE target_child.channel_id = target.channel_id
              AND target_child.deleted = 0
              AND target_child.reply_to = target.id
          )
        )
      )
      AND (
        root.deleted = 0
        OR (
          root.deleted = 1
          AND EXISTS (
            SELECT 1
            FROM messages root_child
            WHERE root_child.channel_id = root.channel_id
              AND root_child.deleted = 0
              AND root_child.reply_to = root.id
          )
        )
      )
    LIMIT 1
  `).bind(channelId, targetId).all<VisibleMessageRow>();
  onResult?.(result);
  return result.results?.[0] || null;
}

export function buildVisibleRootPageQuery(input: {
  channelId: string;
  cursorCondition?: string;
  cursorParams?: unknown[];
  direction: "before" | "after";
  limit: number;
}): { query: string; params: unknown[] } {
  const {
    channelId,
    cursorCondition = "",
    cursorParams = [],
    direction,
    limit,
  } = input;
  const pageOrder = direction === "after" ? "ASC" : "DESC";
  const boundaryOrder = direction === "after" ? "DESC" : "ASC";
  const boundaryComparator = direction === "after" ? "<=" : ">=";
  const fallbackCreatedAt = direction === "after"
    ? "9999-12-31T23:59:59.999Z"
    : "";
  const fallbackId = direction === "after" ? "~" : "";
  const query = `
    WITH active_roots AS MATERIALIZED (
      SELECT *
      FROM messages INDEXED BY messages_active_root_page_idx
      WHERE channel_id = ?
        AND deleted = 0
        AND reply_to IS NULL
        ${cursorCondition}
      ORDER BY created_at ${pageOrder}, id ${pageOrder}
      LIMIT ?
    ),
    active_boundary AS (
      SELECT created_at, id
      FROM active_roots
      WHERE (SELECT COUNT(*) FROM active_roots) = ?
      ORDER BY created_at ${boundaryOrder}, id ${boundaryOrder}
      LIMIT 1
    ),
    page_boundary AS (
      SELECT created_at, id FROM active_boundary
      UNION ALL
      SELECT ?, ?
      LIMIT 1
    ),
    visible_roots AS (
      SELECT * FROM active_roots
      UNION ALL
      SELECT *
      FROM messages INDEXED BY messages_deleted_root_page_idx
      WHERE channel_id = ?
        AND deleted = 1
        AND reply_to IS NULL
        ${cursorCondition}
        AND (created_at, id) ${boundaryComparator} (
          SELECT created_at, id FROM page_boundary
        )
        AND EXISTS (
          SELECT 1
          FROM messages child
          WHERE child.channel_id = ?
            AND child.deleted = 0
            AND child.reply_to = messages.id
        )
    )
    SELECT *
    FROM (
      SELECT *
      FROM visible_roots
      ORDER BY created_at ${pageOrder}, id ${pageOrder}
      LIMIT ?
    )
    ORDER BY created_at ASC, id ASC
  `;
  return {
    query,
    params: [
      channelId,
      ...cursorParams,
      limit,
      limit,
      fallbackCreatedAt,
      fallbackId,
      channelId,
      ...cursorParams,
      channelId,
      limit,
    ],
  };
}

function sortVisibleMessages(messages: VisibleMessageRow[]): VisibleMessageRow[] {
  return [...messages].sort((left, right) =>
    String(left.created_at || "").localeCompare(String(right.created_at || ""))
    || String(left.id).localeCompare(String(right.id))
  );
}

const THREAD_LOOKUP_BUCKETS = [1, 2, 4, 8, 16, 32, 50, 64] as const;

function normalizeThreadLookupIds(ids: string[]): string[] {
  const bucketSize = THREAD_LOOKUP_BUCKETS.find((size) => size >= ids.length);
  if (!bucketSize || ids.length === bucketSize) return ids;
  return [...ids, ...Array(bucketSize - ids.length).fill(ids[ids.length - 1])];
}

export async function expandVisibleRootThreads(
  env: Env,
  channelId: string,
  pageMessages: VisibleMessageRow[],
): Promise<VisibleMessageRow[]> {
  if (pageMessages.length === 0) return pageMessages;

  const rootIds = [...new Set(pageMessages
    .map((message) => String(message.reply_to || message.id))
    .filter(Boolean))];
  const loadedMessageIds = new Set(pageMessages.map((message) => String(message.id)));
  const threadRows = await readVisibleFlatThreads(
    env,
    channelId,
    rootIds,
    loadedMessageIds,
  );

  const byId = new Map<string, VisibleMessageRow>();
  for (const message of [...pageMessages, ...threadRows]) {
    byId.set(String(message.id), message);
  }
  return sortVisibleMessages([...byId.values()]);
}

export async function readVisibleFlatThreads(
  env: Env,
  channelId: string,
  requestedRootIds: string[],
  loadedMessageIds: ReadonlySet<string> = new Set(),
  onResult?: (result: D1Result<VisibleMessageRow>) => void,
): Promise<VisibleMessageRow[]> {
  const rootIds = [...new Set(requestedRootIds.map(String).filter(Boolean))];
  if (rootIds.length === 0) return [];

  const statements: D1PreparedStatement[] = [];
  const missingRootIds = rootIds.filter((rootId) => !loadedMessageIds.has(rootId));
  if (missingRootIds.length > 0) {
    const normalizedMissingRootIds = normalizeThreadLookupIds(missingRootIds);
    const rootPlaceholders = normalizedMissingRootIds.map(() => "?").join(", ");
    statements.push(env.DB.prepare(`
      SELECT *
      FROM messages
      WHERE channel_id = ?
        AND id IN (${rootPlaceholders})
        AND deleted != 2
    `).bind(channelId, ...normalizedMissingRootIds));
  }

  const normalizedRootIds = normalizeThreadLookupIds(rootIds);
  const childPlaceholders = normalizedRootIds.map(() => "?").join(", ");
  statements.push(env.DB.prepare(`
      SELECT *
      FROM messages
      WHERE channel_id = ?
        AND reply_to IN (${childPlaceholders})
        AND deleted = 0
    `).bind(channelId, ...normalizedRootIds));

  const results = await env.DB.batch<VisibleMessageRow>(statements);
  for (const result of results) onResult?.(result);
  return sortVisibleMessages(results.flatMap((result) => result.results || []));
}

export async function readVisibleMessagePage(
  env: Env,
  channelId: string,
  input?: {
    cursor?: string | null;
    cursorId?: string | null;
    direction?: "before" | "after" | null;
    limit?: number;
  },
): Promise<{
  messages: VisibleMessageRow[];
  hasMore: boolean;
  pageStartCursor: VisibleMessageCursor | null;
  pageEndCursor: VisibleMessageCursor | null;
}> {
  const cursor = input?.cursor || null;
  const cursorId = input?.cursorId || null;
  const direction = input?.direction || null;
  const limit = input?.limit || 50;

  let cursorCondition = "";
  const cursorParams: unknown[] = [];

  if (cursor) {
    if (direction === "after") {
      cursorCondition = cursorId
        ? " AND (created_at, id) > (?, ?)"
        : " AND created_at > ?";
      cursorParams.push(cursor, ...(cursorId ? [cursorId] : []));
    } else {
      cursorCondition = cursorId
        ? " AND (created_at, id) < (?, ?)"
        : " AND created_at < ?";
      cursorParams.push(cursor, ...(cursorId ? [cursorId] : []));
    }
  }

  const { query, params } = buildVisibleRootPageQuery({
    channelId,
    cursorCondition,
    cursorParams,
    direction: direction === "after" ? "after" : "before",
    limit: limit + 1,
  });
  const { results } = await env.DB.prepare(query).bind(...params).all<VisibleMessageRow>();
  const rawResults = results || [];
  const hasMore = rawResults.length > limit;
  const pageResults = hasMore
    ? direction === "after"
      ? rawResults.slice(0, limit)
      : rawResults.slice(rawResults.length - limit)
    : rawResults;
  const pageStart = pageResults[0];
  const pageEnd = pageResults.at(-1);

  return {
    messages: await expandVisibleRootThreads(env, channelId, pageResults),
    hasMore,
    pageStartCursor: pageStart?.created_at
      ? { id: pageStart.id, createdAt: pageStart.created_at }
      : null,
    pageEndCursor: pageEnd?.created_at
      ? { id: pageEnd.id, createdAt: pageEnd.created_at }
      : null,
  };
}
