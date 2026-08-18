import type { Env } from "../types.ts";
import {
  VISIBLE_ROOT_MESSAGE_CONDITION,
  readVisibleFlatThreads,
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
}

const SOURCE_RANK: Record<UnifiedTimelineSource, number> = {
  message: 0,
  dm: 1,
};
const REPLY_LOOKUP_BUCKETS = [1, 2, 4, 8, 16, 32, 50] as const;

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
): Promise<RootCandidate[]> {
  let innerQuery = `SELECT * FROM messages WHERE ${VISIBLE_ROOT_MESSAGE_CONDITION}`;
  const params: unknown[] = [channelId, channelId];
  innerQuery = appendRootCursorRange(innerQuery, params, "message", cursor, direction);
  innerQuery += direction === "after"
    ? " ORDER BY created_at ASC, id ASC LIMIT ?"
    : " ORDER BY created_at DESC, id DESC LIMIT ?";
  params.push(candidateLimit);
  const query = `SELECT * FROM (${innerQuery}) ORDER BY created_at ASC, id ASC`;
  const result = await env.DB.prepare(query).bind(...params).all<RootRow>();
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
): Promise<DmReplyRow[]> {
  const results = await Promise.all(chunkLookupIds(rootIds).map(async (rootChunk) => {
    const lookupIds = normalizeLookupIds(rootChunk);
    const placeholders = lookupIds.map(() => "?").join(", ");
    return env.DB.prepare(`
      SELECT id, client_reply_id, dm_id, channel_id, owner_uid, text, image, created_at
      FROM dm_replies
      WHERE channel_id = ?
        AND dm_id IN (${placeholders})
        AND pending_delete_at IS NULL
      ORDER BY created_at ASC, id ASC
    `).bind(channelId, ...lookupIds).all<DmReplyRow>();
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

  const [messageCandidates, dmCandidates] = await Promise.all([
    readMessageRootCandidates(env, channelId, cursor, direction, candidateLimit),
    readDmRootCandidates(env, channelId, viewer, cursor, direction, candidateLimit),
  ]);
  const candidates = [...messageCandidates, ...dmCandidates]
    .sort((left, right) => compareUnifiedTimelineCursor(left.cursor, right.cursor));
  const hasMore = candidates.length > limit;
  const roots = direction === "after"
    ? candidates.slice(0, limit)
    : candidates.slice(Math.max(0, candidates.length - limit));
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
          )
        )).then((chunks) => chunks.flat())
      : Promise.resolve([]),
    readDmReplies(env, channelId, dmRootIds),
  ]);
  const messageRootMap = new Map(messageRoots.map((root) => [root.row.id, root]));
  const dmRootMap = new Map(dmRoots.map((root) => [root.row.id, root]));
  const items = [
    ...messageRoots.map((root) => normalizeMessageItem(root.row, messageRootMap)),
    ...messageReplies.map((reply) => normalizeMessageItem(reply, messageRootMap)),
    ...dmRoots.map(normalizeDmRoot),
    ...dmReplies.map((reply) => normalizeDmReply(reply, dmRootMap)),
  ].filter((item): item is UnifiedTimelineItem => item !== null)
    .sort((left, right) => compareUnifiedTimelineCursor(itemCursor(left), itemCursor(right)));

  return {
    items,
    hasMore,
    pageStartCursor: roots[0]?.cursor || null,
    pageEndCursor: roots.at(-1)?.cursor || null,
    rootCount: roots.length,
  };
}
