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

export function visibleMessageConditionForAlias(alias: string): string {
  return `
    ${alias}.channel_id = ?
    AND (
      ${alias}.deleted = 0
      OR (
        ${alias}.deleted = 1
        AND ${alias}.id IN (
          SELECT reply_to FROM messages
          WHERE channel_id = ? AND deleted = 0 AND reply_to IS NOT NULL
        )
      )
    )
  `;
}

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

  const pageIds = [...new Set(pageMessages.map((message) => String(message.id)).filter(Boolean))];
  if (pageIds.length === 0) return pageMessages;

  const pageIdPlaceholders = pageIds.map(() => "?").join(", ");
  const ancestorRows = await env.DB.prepare(`
    WITH RECURSIVE ancestors(seed_id, id, reply_to, depth) AS (
      SELECT id AS seed_id, id, reply_to, 0
      FROM messages
      WHERE id IN (${pageIdPlaceholders})
      UNION ALL
      SELECT ancestors.seed_id, parent.id, parent.reply_to, ancestors.depth + 1
      FROM messages parent
      INNER JOIN ancestors ON ancestors.reply_to = parent.id
      WHERE ${visibleMessageConditionForAlias("parent")}
    )
    SELECT seed_id, id, depth
    FROM ancestors
    ORDER BY seed_id ASC, depth DESC
  `).bind(...pageIds, channelId, channelId).all<{ seed_id: string; id: string; depth: number }>();

  const rootIds: string[] = [];
  const resolvedSeedIds = new Set<string>();
  for (const row of ancestorRows.results || []) {
    if (resolvedSeedIds.has(row.seed_id)) continue;
    resolvedSeedIds.add(row.seed_id);
    rootIds.push(row.id);
  }
  if (rootIds.length === 0) return sortVisibleMessages(pageMessages);

  const rootPlaceholders = rootIds.map(() => "?").join(", ");
  const threadRows = await env.DB.prepare(`
    WITH RECURSIVE thread(id) AS (
      SELECT id
      FROM messages
      WHERE id IN (${rootPlaceholders}) AND ${VISIBLE_MESSAGE_CONDITION}
      UNION
      SELECT child.id
      FROM messages child
      INNER JOIN thread parent_thread ON child.reply_to = parent_thread.id
      WHERE ${visibleMessageConditionForAlias("child")}
    )
    SELECT * FROM messages
    WHERE id IN (SELECT id FROM thread)
    ORDER BY created_at ASC, id ASC
  `).bind(...rootIds, channelId, channelId, channelId, channelId).all<VisibleMessageRow>();

  const byId = new Map<string, VisibleMessageRow>();
  for (const message of [...pageMessages, ...(threadRows.results || [])]) {
    byId.set(String(message.id), message);
  }
  return sortVisibleMessages([...byId.values()]);
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
