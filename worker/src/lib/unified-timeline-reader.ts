import type { Env } from "../types.ts";
import {
  buildVisibleRootPageQuery,
  VISIBLE_ROOT_MESSAGE_CONDITION,
  readVisibleFlatThreads,
  readVisibleTargetRoot,
  type VisibleMessageRow,
} from "./visible-messages.ts";
import {
  UNIFIED_TIMELINE_PAGE_SIZE,
  clampUnifiedTimelinePageSize,
  compareUnifiedTimelineCursor,
  type UnifiedTimelineCursor,
  type UnifiedTimelineSource,
} from "./unified-timeline.ts";
import type { UnifiedTimelineViewer } from "./unified-timeline-viewer.ts";

type TimelineDirection = "before" | "after";

type RootRow = Record<string, unknown> & {
  id: string;
  created_at: string;
};

type DmReplyRow = Record<string, unknown> & {
  id: string;
  dm_id: string;
  owner_uid: string;
  text: string;
  image: string | null;
  image_w: number | null;
  image_h: number | null;
  channel_id: string;
  created_at: string;
};

export type UnifiedTimelineItem = Record<string, unknown> & {
  id: string;
  source: UnifiedTimelineSource;
  visual_root_created_at: string;
  visual_root_id: string;
  visual_depth: 0 | 1;
  created_at: string;
};

interface RootCandidate {
  source: UnifiedTimelineSource;
  row: RootRow;
  cursor: UnifiedTimelineCursor;
}

export interface UnifiedTimelinePage {
  items: UnifiedTimelineItem[];
  hasMore: boolean;
  pageStartCursor: UnifiedTimelineCursor | null;
  pageEndCursor: UnifiedTimelineCursor | null;
  rootCount: number;
  metrics: UnifiedTimelineReadMetrics;
}

export interface UnifiedTimelineContextPage extends UnifiedTimelinePage {
  hasOlder: boolean;
  hasNewer: boolean;
  targetId: string;
  targetSource: UnifiedTimelineSource;
}

const SOURCE_RANK: Record<UnifiedTimelineSource, number> = {
  message: 0,
  dm: 1,
};
const REPLY_LOOKUP_BUCKETS = [1, 2, 4, 8, 16, 32, 50] as const;
export const UNIFIED_TIMELINE_FANOUT_WARNING_ITEMS = 300;

export interface UnifiedTimelineReadMetrics {
  queryCount: number;
  rowsRead: number;
  d1DurationMs: number;
  rootCount: number;
  itemCount: number;
  maxChildrenPerRoot: number;
  messageRootCount: number;
  dmRootCount: number;
  messageReplyCount: number;
  dmReplyCount: number;
}

function createReadMetrics(): UnifiedTimelineReadMetrics {
  return {
    queryCount: 0,
    rowsRead: 0,
    d1DurationMs: 0,
    rootCount: 0,
    itemCount: 0,
    maxChildrenPerRoot: 0,
    messageRootCount: 0,
    dmRootCount: 0,
    messageReplyCount: 0,
    dmReplyCount: 0,
  };
}

function recordQueryResult(
  metrics: UnifiedTimelineReadMetrics,
  result: { meta?: Partial<D1Meta> },
): void {
  metrics.queryCount += 1;
  metrics.rowsRead += Number(result.meta?.rows_read || 0);
  metrics.d1DurationMs += Number(
    result.meta?.timings?.sql_duration_ms
    ?? result.meta?.duration
    ?? 0,
  );
}

function finalizeReadMetrics(
  metrics: UnifiedTimelineReadMetrics,
  roots: RootCandidate[],
  items: UnifiedTimelineItem[],
): UnifiedTimelineReadMetrics {
  const childCounts = new Map<string, number>();
  let maxChildrenPerRoot = 0;
  let messageRootCount = 0;
  for (const root of roots) {
    if (root.source === "message") messageRootCount += 1;
  }
  for (const item of items) {
    if (item.visual_depth === 0) continue;
    const key = `${item.source}:${item.visual_root_id}`;
    const childCount = (childCounts.get(key) || 0) + 1;
    childCounts.set(key, childCount);
    maxChildrenPerRoot = Math.max(maxChildrenPerRoot, childCount);
    if (item.source === "message") {
      metrics.messageReplyCount += 1;
    } else {
      metrics.dmReplyCount += 1;
    }
  }
  metrics.rootCount = roots.length;
  metrics.itemCount = items.length;
  metrics.maxChildrenPerRoot = maxChildrenPerRoot;
  metrics.messageRootCount = messageRootCount;
  metrics.dmRootCount = roots.length - metrics.messageRootCount;
  return metrics;
}

function rootCursor(source: UnifiedTimelineSource, row: RootRow): UnifiedTimelineCursor {
  return {
    visual_root_created_at: row.created_at,
    source,
    visual_root_id: row.id,
    visual_depth: 0,
    created_at: row.created_at,
    id: row.id,
  };
}

function normalizeLookupIds(ids: string[]): string[] {
  if (ids.length === 0) return [];
  const bucket = REPLY_LOOKUP_BUCKETS.find((size) => size >= ids.length);
  if (!bucket || bucket === ids.length) return ids;
  return [...ids, ...Array(bucket - ids.length).fill(ids[ids.length - 1])];
}

function chunkLookupIds(ids: string[], size = 50): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

function appendRootCursorRange(
  query: string,
  params: unknown[],
  source: UnifiedTimelineSource,
  cursor: UnifiedTimelineCursor | null,
  direction: TimelineDirection,
): string {
  if (!cursor) return query;
  const sourceRank = SOURCE_RANK[source];
  const cursorRank = SOURCE_RANK[cursor.source];
  const comparator = direction === "after" ? ">" : "<";
  if (sourceRank === cursorRank) {
    query += ` AND (
      created_at ${comparator} ?
      OR (created_at = ? AND id ${comparator} ?)
    )`;
    params.push(
      cursor.visual_root_created_at,
      cursor.visual_root_created_at,
      cursor.visual_root_id,
    );
    return query;
  }
  const includesCursorTimestamp = direction === "after"
    ? sourceRank > cursorRank
    : sourceRank < cursorRank;
  query += ` AND created_at ${includesCursorTimestamp ? `${comparator}=` : comparator} ?`;
  params.push(cursor.visual_root_created_at);
  return query;
}

async function readMessageRootCandidates(
  env: Env,
  channelId: string,
  cursor: UnifiedTimelineCursor | null,
  direction: TimelineDirection,
  candidateLimit: number,
  metrics: UnifiedTimelineReadMetrics,
): Promise<RootCandidate[]> {
  const cursorParams: unknown[] = [];
  const cursorCondition = appendRootCursorRange(
    "",
    cursorParams,
    "message",
    cursor,
    direction,
  );
  const { query, params } = buildVisibleRootPageQuery({
    channelId,
    cursorCondition,
    cursorParams,
    direction,
    limit: candidateLimit,
  });
  const result = await env.DB.prepare(query).bind(...params).all<RootRow>();
  recordQueryResult(metrics, result);
  return (result.results || []).map((row) => ({
    source: "message",
    row,
    cursor: rootCursor("message", row),
  }));
}

async function readDmRootCandidates(
  env: Env,
  channelId: string,
  viewer: UnifiedTimelineViewer,
  cursor: UnifiedTimelineCursor | null,
  direction: TimelineDirection,
  candidateLimit: number,
  metrics: UnifiedTimelineReadMetrics,
): Promise<RootCandidate[]> {
  let innerQuery = "SELECT * FROM dm WHERE channel_id = ? AND pending_delete_at IS NULL";
  const params: unknown[] = [channelId];
  if (!viewer.owner) {
    innerQuery += " AND uid = ?";
    params.push(viewer.anonymousUid);
  }
  innerQuery = appendRootCursorRange(innerQuery, params, "dm", cursor, direction);
  innerQuery += direction === "after"
    ? " ORDER BY created_at ASC, id ASC LIMIT ?"
    : " ORDER BY created_at DESC, id DESC LIMIT ?";
  params.push(candidateLimit);
  const query = `SELECT * FROM (${innerQuery}) ORDER BY created_at ASC, id ASC`;
  const result = await env.DB.prepare(query).bind(...params).all<RootRow>();
  recordQueryResult(metrics, result);
  return (result.results || []).map((row) => ({
    source: "dm",
    row,
    cursor: rootCursor("dm", row),
  }));
}

async function readDmReplies(
  env: Env,
  channelId: string,
  rootIds: string[],
  metrics: UnifiedTimelineReadMetrics,
): Promise<DmReplyRow[]> {
  const results = await Promise.all(chunkLookupIds(rootIds).map(async (rootChunk) => {
    const lookupIds = normalizeLookupIds(rootChunk);
    const placeholders = lookupIds.map(() => "?").join(", ");
    const result = await env.DB.prepare(`
      SELECT id, client_reply_id, dm_id, channel_id, owner_uid, text, image, image_w, image_h, created_at
      FROM dm_replies
      WHERE channel_id = ?
        AND dm_id IN (${placeholders})
        AND pending_delete_at IS NULL
      ORDER BY created_at ASC, id ASC
    `).bind(channelId, ...lookupIds).all<DmReplyRow>();
    recordQueryResult(metrics, result);
    return result;
  }));
  return results.flatMap((result) => result.results || []);
}

function normalizeMessageItem(
  row: VisibleMessageRow,
  roots: Map<string, RootCandidate>,
): UnifiedTimelineItem | null {
  const rootId = String(row.reply_to || row.id);
  const root = roots.get(rootId);
  if (!root) return null;
  return {
    ...row,
    id: String(row.id),
    source: "message",
    visual_root_created_at: root.row.created_at,
    visual_root_id: root.row.id,
    visual_depth: row.reply_to ? 1 : 0,
    created_at: String(row.created_at || root.row.created_at),
  };
}

function normalizeDmRoot(root: RootCandidate): UnifiedTimelineItem {
  return {
    ...root.row,
    source: "dm",
    visual_root_created_at: root.row.created_at,
    visual_root_id: root.row.id,
    visual_depth: 0,
    created_at: root.row.created_at,
    dm: true,
    reply_to: null,
    is_admin: 0,
    reactions: "{}",
  };
}

function normalizeDmReply(
  reply: DmReplyRow,
  roots: Map<string, RootCandidate>,
): UnifiedTimelineItem | null {
  const root = roots.get(reply.dm_id);
  if (!root) return null;
  return {
    ...reply,
    id: reply.id,
    source: "dm",
    visual_root_created_at: root.row.created_at,
    visual_root_id: root.row.id,
    visual_depth: 1,
    created_at: reply.created_at,
    client_message_id: reply.client_reply_id,
    uid: reply.owner_uid,
    auth_uid: reply.owner_uid,
    nick: null,
    reactions: "{}",
    reply_to: reply.dm_id,
    dm: true,
    dm_reply: true,
    is_admin: 1,
  };
}

function itemCursor(item: UnifiedTimelineItem): UnifiedTimelineCursor {
  return {
    visual_root_created_at: item.visual_root_created_at,
    source: item.source,
    visual_root_id: item.visual_root_id,
    visual_depth: item.visual_depth,
    created_at: item.created_at,
    id: item.id,
  };
}

async function expandRootCandidates(
  env: Env,
  channelId: string,
  roots: RootCandidate[],
  metrics: UnifiedTimelineReadMetrics,
): Promise<UnifiedTimelineItem[]> {
  const messageRoots = roots.filter((root) => root.source === "message");
  const dmRoots = roots.filter((root) => root.source === "dm");
  const messageRootIds = messageRoots.map((root) => root.row.id);
  const dmRootIds = dmRoots.map((root) => root.row.id);
  const [messageReplies, dmReplies] = await Promise.all([
    messageRootIds.length > 0
      ? Promise.all(chunkLookupIds(messageRootIds).map((rootChunk) =>
          readVisibleFlatThreads(
            env,
            channelId,
            rootChunk,
            new Set(rootChunk),
            (result) => recordQueryResult(metrics, result),
          )
        )).then((chunks) => chunks.flat())
      : Promise.resolve([]),
    readDmReplies(env, channelId, dmRootIds, metrics),
  ]);
  const messageRootMap = new Map(messageRoots.map((root) => [root.row.id, root]));
  const dmRootMap = new Map(dmRoots.map((root) => [root.row.id, root]));
  return [
    ...messageRoots.map((root) => normalizeMessageItem(root.row, messageRootMap)),
    ...messageReplies.map((reply) => normalizeMessageItem(reply, messageRootMap)),
    ...dmRoots.map(normalizeDmRoot),
    ...dmReplies.map((reply) => normalizeDmReply(reply, dmRootMap)),
  ].filter((item): item is UnifiedTimelineItem => item !== null)
    .sort((left, right) => compareUnifiedTimelineCursor(itemCursor(left), itemCursor(right)));
}

export async function readUnifiedTimelinePage(
  env: Env,
  channelId: string,
  viewer: UnifiedTimelineViewer,
  input?: {
    cursor?: UnifiedTimelineCursor | null;
    direction?: TimelineDirection;
    limit?: number;
  },
): Promise<UnifiedTimelinePage> {
  const direction = input?.direction || "before";
  const limit = clampUnifiedTimelinePageSize(input?.limit || UNIFIED_TIMELINE_PAGE_SIZE);
  const candidateLimit = limit + 1;
  const cursor = input?.cursor || null;
  const metrics = createReadMetrics();

  const [messageCandidates, dmCandidates] = await Promise.all([
    readMessageRootCandidates(env, channelId, cursor, direction, candidateLimit, metrics),
    readDmRootCandidates(env, channelId, viewer, cursor, direction, candidateLimit, metrics),
  ]);
  const candidates = [...messageCandidates, ...dmCandidates]
    .sort((left, right) => compareUnifiedTimelineCursor(left.cursor, right.cursor));
  const hasMore = candidates.length > limit;
  const roots = direction === "after"
    ? candidates.slice(0, limit)
    : candidates.slice(Math.max(0, candidates.length - limit));
  const items = await expandRootCandidates(env, channelId, roots, metrics);

  return {
    items,
    hasMore,
    pageStartCursor: roots[0]?.cursor || null,
    pageEndCursor: roots.at(-1)?.cursor || null,
    rootCount: roots.length,
    metrics: finalizeReadMetrics(metrics, roots, items),
  };
}

async function resolveTargetRoot(
  env: Env,
  channelId: string,
  viewer: UnifiedTimelineViewer,
  source: UnifiedTimelineSource,
  targetId: string,
  metrics: UnifiedTimelineReadMetrics,
): Promise<RootCandidate | null> {
  if (source === "dm") {
    const params: unknown[] = [channelId, channelId, targetId, targetId];
    let query = `
      SELECT d.* FROM dm d
      WHERE d.channel_id = ?
        AND d.pending_delete_at IS NULL
        AND d.id = COALESCE(
          (SELECT dm_id FROM dm_replies
           WHERE channel_id = ? AND id = ? AND pending_delete_at IS NULL),
          ?
        )`;
    if (!viewer.owner) {
      query += " AND d.uid = ?";
      params.push(viewer.anonymousUid);
    }
    const result = await env.DB.prepare(query).bind(...params).all<RootRow>();
    recordQueryResult(metrics, result);
    const row = result.results?.[0] || null;
    return row ? { source, row, cursor: rootCursor(source, row) } : null;
  }

  const row = await readVisibleTargetRoot(
    env,
    channelId,
    targetId,
    (result) => recordQueryResult(metrics, result),
  ) as RootRow | null;
  return row ? { source, row, cursor: rootCursor(source, row) } : null;
}

export async function readUnifiedTimelineContextPage(
  env: Env,
  channelId: string,
  viewer: UnifiedTimelineViewer,
  targetSource: UnifiedTimelineSource,
  targetId: string,
  radius = 25,
): Promise<UnifiedTimelineContextPage | null> {
  const metrics = createReadMetrics();
  const target = await resolveTargetRoot(
    env,
    channelId,
    viewer,
    targetSource,
    targetId,
    metrics,
  );
  if (!target) return null;
  const candidateLimit = radius + 1;
  const [messageBefore, dmBefore, messageAfter, dmAfter] = await Promise.all([
    readMessageRootCandidates(env, channelId, target.cursor, "before", candidateLimit, metrics),
    readDmRootCandidates(env, channelId, viewer, target.cursor, "before", candidateLimit, metrics),
    readMessageRootCandidates(env, channelId, target.cursor, "after", candidateLimit, metrics),
    readDmRootCandidates(env, channelId, viewer, target.cursor, "after", candidateLimit, metrics),
  ]);
  const before = [...messageBefore, ...dmBefore]
    .sort((a, b) => compareUnifiedTimelineCursor(a.cursor, b.cursor));
  const after = [...messageAfter, ...dmAfter]
    .sort((a, b) => compareUnifiedTimelineCursor(a.cursor, b.cursor));
  const roots = [
    ...before.slice(Math.max(0, before.length - radius)),
    target,
    ...after.slice(0, radius),
  ];
  const items = await expandRootCandidates(env, channelId, roots, metrics);
  return {
    items,
    hasMore: before.length > radius || after.length > radius,
    hasOlder: before.length > radius,
    hasNewer: after.length > radius,
    pageStartCursor: roots[0]?.cursor || null,
    pageEndCursor: roots.at(-1)?.cursor || null,
    rootCount: roots.length,
    metrics: finalizeReadMetrics(metrics, roots, items),
    targetId,
    targetSource,
  };
}
