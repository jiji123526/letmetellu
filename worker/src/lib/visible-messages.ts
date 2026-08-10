import type { Env } from "../types.ts";

export type VisibleMessageRow = Record<string, unknown> & {
  id: string;
  reply_to?: string | null;
  created_at?: string;
};

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

function sortVisibleMessages(messages: VisibleMessageRow[]): VisibleMessageRow[] {
  return [...messages].sort((left, right) =>
    String(left.created_at || "").localeCompare(String(right.created_at || ""))
    || String(left.id).localeCompare(String(right.id))
  );
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
  const threadRows = await readVisibleFlatThreads(env, channelId, rootIds);

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
): Promise<VisibleMessageRow[]> {
  const rootIds = [...new Set(requestedRootIds.map(String).filter(Boolean))];
  if (rootIds.length === 0) return [];

  const rootPlaceholders = rootIds.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(`
    SELECT * FROM (
      SELECT *
      FROM messages
      WHERE channel_id = ? AND id IN (${rootPlaceholders})
      UNION ALL
      SELECT *
      FROM messages
      WHERE channel_id = ?
        AND reply_to IN (${rootPlaceholders})
        AND deleted = 0
    )
    ORDER BY created_at ASC, id ASC
  `).bind(channelId, ...rootIds, channelId, ...rootIds).all<VisibleMessageRow>();
  return results || [];
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
): Promise<{ messages: VisibleMessageRow[]; hasMore: boolean }> {
  const cursor = input?.cursor || null;
  const cursorId = input?.cursorId || null;
  const direction = input?.direction || null;
  const limit = input?.limit || 50;

  let innerQuery = `SELECT * FROM messages WHERE ${VISIBLE_MESSAGE_CONDITION}`;
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

  return {
    messages: await expandVisibleRootThreads(env, channelId, pageResults),
    hasMore,
  };
}
