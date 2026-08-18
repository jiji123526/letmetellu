import type { Message } from "./chatTypes";

export type ChatTimelineSource = "message" | "dm";

export interface ChatTimelineItem extends Message {
  source: ChatTimelineSource;
  visual_root_created_at: string;
  visual_root_id: string;
  visual_depth: 0 | 1;
}

export interface UnifiedTimelineCursor {
  visual_root_created_at: string;
  source: ChatTimelineSource;
  visual_root_id: string;
  visual_depth: 0 | 1;
  created_at: string;
  id: string;
}

export type ChatTimelineState =
  | { mode: "legacy"; messages: Message[]; dmMessages: Message[] }
  | {
      mode: "unified";
      timelineItems: ChatTimelineItem[];
      pageStartCursor: UnifiedTimelineCursor | null;
      pageEndCursor: UnifiedTimelineCursor | null;
      hasMoreBefore: boolean;
      hasMoreAfter: boolean;
    };

export type MessageCollectionUpdate =
  | Message[]
  | ((previous: Message[]) => Message[]);

const SOURCE_RANK: Record<ChatTimelineSource, number> = {
  message: 0,
  dm: 1,
};
const MAX_MOUNTED_TIMELINE_ITEMS = 300;

function compareTimelinePositions(
  left: UnifiedTimelineCursor,
  right: UnifiedTimelineCursor,
): number {
  return left.visual_root_created_at.localeCompare(right.visual_root_created_at)
    || SOURCE_RANK[left.source] - SOURCE_RANK[right.source]
    || left.visual_root_id.localeCompare(right.visual_root_id)
    || left.visual_depth - right.visual_depth
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id);
}

function compareTimelineItems(left: ChatTimelineItem, right: ChatTimelineItem): number {
  return compareTimelinePositions(left, right);
}

function normalizeSourceItems(
  source: ChatTimelineSource,
  messages: Message[],
): ChatTimelineItem[] {
  const byId = new Map(messages.map((message) => [message.id, message]));

  return messages.map((message) => {
    let root = message;
    const visited = new Set([message.id]);
    while (root.reply_to) {
      const parent = byId.get(root.reply_to);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      root = parent;
    }

    const existing = message as Partial<ChatTimelineItem>;
    const hasCanonicalPosition = existing.source === source
      && typeof existing.visual_root_created_at === "string"
      && existing.visual_root_created_at.length > 0
      && typeof existing.visual_root_id === "string"
      && existing.visual_root_id.length > 0
      && (existing.visual_depth === 0 || existing.visual_depth === 1);

    return {
      ...message,
      source,
      visual_root_created_at: hasCanonicalPosition
        ? existing.visual_root_created_at!
        : root.created_at,
      visual_root_id: hasCanonicalPosition
        ? existing.visual_root_id!
        : root.id,
      visual_depth: hasCanonicalPosition
        ? existing.visual_depth!
        : message.reply_to ? 1 : 0,
      dm: source === "dm" ? true : message.dm,
    };
  });
}

export function createUnifiedTimelineItems(
  messages: Message[],
  dmMessages: Message[],
): ChatTimelineItem[] {
  const byIdentity = new Map<string, ChatTimelineItem>();
  const normalized = [
    ...normalizeSourceItems("message", messages),
    ...normalizeSourceItems("dm", dmMessages),
  ];
  for (const item of normalized) {
    byIdentity.set(`${item.source}:${item.id}`, item);
  }
  return [...byIdentity.values()].sort(compareTimelineItems);
}

export function createInitialChatTimelineState(): ChatTimelineState {
  return { mode: "legacy", messages: [], dmMessages: [] };
}

export function selectTimelineMessages(state: ChatTimelineState): Message[] {
  return state.mode === "legacy"
    ? state.messages
    : state.timelineItems.filter((item) => item.source === "message");
}

export function selectTimelineDmMessages(state: ChatTimelineState): Message[] {
  return state.mode === "legacy"
    ? state.dmMessages
    : state.timelineItems.filter((item) => item.source === "dm");
}

export function setChatTimelineMode(
  state: ChatTimelineState,
  unifiedEnabled: boolean,
): ChatTimelineState {
  if (unifiedEnabled && state.mode === "legacy") {
    return {
      mode: "unified",
      timelineItems: createUnifiedTimelineItems(state.messages, state.dmMessages),
      pageStartCursor: null,
      pageEndCursor: null,
      hasMoreBefore: false,
      hasMoreAfter: false,
    };
  }
  if (!unifiedEnabled && state.mode === "unified") {
    return {
      mode: "legacy",
      messages: selectTimelineMessages(state),
      dmMessages: selectTimelineDmMessages(state),
    };
  }
  return state;
}

export function updateChatTimelineSource(
  state: ChatTimelineState,
  source: ChatTimelineSource,
  update: MessageCollectionUpdate,
): ChatTimelineState {
  const current = source === "message"
    ? selectTimelineMessages(state)
    : selectTimelineDmMessages(state);
  const next = typeof update === "function" ? update(current) : update;

  if (state.mode === "legacy") {
    return source === "message"
      ? { ...state, messages: next }
      : { ...state, dmMessages: next };
  }

  const otherSource = state.timelineItems.filter((item) => item.source !== source);
  return {
    mode: "unified",
    timelineItems: createUnifiedTimelineItems(
      source === "message" ? next : otherSource,
      source === "dm" ? next : otherSource,
    ),
    pageStartCursor: state.pageStartCursor,
    pageEndCursor: state.pageEndCursor,
    hasMoreBefore: state.hasMoreBefore,
    hasMoreAfter: state.hasMoreAfter,
  };
}

export function replaceUnifiedTimelinePage(
  state: ChatTimelineState,
  items: ChatTimelineItem[],
  pageStartCursor: UnifiedTimelineCursor | null,
  pageEndCursor: UnifiedTimelineCursor | null,
  hasMoreBefore = false,
  hasMoreAfter = false,
): ChatTimelineState {
  if (state.mode !== "unified") return state;
  return {
    mode: "unified",
    timelineItems: createUnifiedTimelineItems(
      items.filter((item) => item.source === "message"),
      items.filter((item) => item.source === "dm"),
    ),
    pageStartCursor,
    pageEndCursor,
    hasMoreBefore,
    hasMoreAfter,
  };
}

function rootCursor(item: ChatTimelineItem): UnifiedTimelineCursor {
  return {
    visual_root_created_at: item.visual_root_created_at,
    source: item.source,
    visual_root_id: item.visual_root_id,
    visual_depth: 0,
    created_at: item.visual_root_created_at,
    id: item.visual_root_id,
  };
}

export function mergeUnifiedTimelineLatestPage(
  state: ChatTimelineState,
  items: ChatTimelineItem[],
  pageStartCursor: UnifiedTimelineCursor | null,
  pageEndCursor: UnifiedTimelineCursor | null,
  hasMoreBefore: boolean,
): ChatTimelineState {
  if (state.mode !== "unified" || !pageStartCursor) {
    return replaceUnifiedTimelinePage(
      state,
      items,
      pageStartCursor,
      pageEndCursor,
      hasMoreBefore,
      false,
    );
  }

  const olderItems = state.timelineItems.filter(
    (item) => compareTimelinePositions(rootCursor(item), pageStartCursor) < 0,
  );
  return {
    mode: "unified",
    timelineItems: createUnifiedTimelineItems(
      [...olderItems, ...items].filter((item) => item.source === "message"),
      [...olderItems, ...items].filter((item) => item.source === "dm"),
    ),
    pageStartCursor: olderItems.length > 0
      ? state.pageStartCursor
      : pageStartCursor,
    pageEndCursor,
    hasMoreBefore: olderItems.length > 0
      ? state.hasMoreBefore
      : hasMoreBefore,
    hasMoreAfter: false,
  };
}

export function mergeUnifiedTimelinePage(
  state: ChatTimelineState,
  direction: "before" | "after",
  items: ChatTimelineItem[],
  pageStartCursor: UnifiedTimelineCursor | null,
  pageEndCursor: UnifiedTimelineCursor | null,
  hasMore: boolean,
): ChatTimelineState {
  if (state.mode !== "unified") return state;
  const combined = [...state.timelineItems, ...items];
  const normalized = createUnifiedTimelineItems(
    combined.filter((item) => item.source === "message"),
    combined.filter((item) => item.source === "dm"),
  );
  const rootCounts = new Map<string, number>();
  for (const item of normalized) {
    const key = `${item.source}:${item.visual_root_id}`;
    rootCounts.set(key, (rootCounts.get(key) || 0) + 1);
  }
  const rootKeys = [...rootCounts.keys()];
  const orderedKeys = direction === "before" ? rootKeys : [...rootKeys].reverse();
  const selectedKeys = new Set<string>();
  let selectedCount = 0;
  for (const key of orderedKeys) {
    const groupSize = rootCounts.get(key) || 0;
    if (selectedKeys.size > 0 && selectedCount + groupSize > MAX_MOUNTED_TIMELINE_ITEMS) break;
    selectedKeys.add(key);
    selectedCount += groupSize;
  }
  const trimmed = normalized.filter((item) =>
    selectedKeys.has(`${item.source}:${item.visual_root_id}`)
  );
  const trimmedStart = trimmed[0] ? rootCursor(trimmed[0]) : pageStartCursor;
  const trimmedEnd = trimmed.at(-1) ? rootCursor(trimmed.at(-1)!) : pageEndCursor;
  const didTrim = trimmed.length < normalized.length;
  return {
    mode: "unified",
    timelineItems: trimmed,
    pageStartCursor: direction === "before"
      ? pageStartCursor
      : didTrim ? trimmedStart : state.pageStartCursor,
    pageEndCursor: direction === "after"
      ? pageEndCursor
      : didTrim ? trimmedEnd : state.pageEndCursor,
    hasMoreBefore: direction === "before"
      ? hasMore
      : didTrim || state.hasMoreBefore,
    hasMoreAfter: direction === "after"
      ? hasMore
      : didTrim || state.hasMoreAfter,
  };
}
