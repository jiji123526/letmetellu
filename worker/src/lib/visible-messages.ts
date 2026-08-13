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
      AND id IN (
        SELECT reply_to FROM messages
        WHERE channel_id = ? AND deleted = 0 AND reply_to IS NOT NULL
      )
    )
  )
`;

export const VISIBLE_ROOT_MESSAGE_CONDITION = `
  ${VISIBLE_MESSAGE_CONDITION}
  AND reply_to IS NULL
`;

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

  let innerQuery = `SELECT * FROM messages WHERE ${VISIBLE_ROOT_MESSAGE_CONDITION}`;
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
  params.push(limit + 1);

  const query = `SELECT * FROM (${innerQuery}) ORDER BY created_at ASC, id ASC`;
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
