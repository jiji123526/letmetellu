import type { Message } from "./chatTypes";

export type ChatTimelineSource = "message" | "dm";

export interface ChatTimelineItem extends Message {
  source: ChatTimelineSource;
  visual_root_created_at: string;
  visual_root_id: string;
  visual_depth: 0 | 1;
}

export interface ChatTimelineIdentity {
  source: ChatTimelineSource;
  id: string;
}

export interface ChatTimelineMutationItem {
  source: ChatTimelineSource;
  message: Message;
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

function isCanonicalTimelineItem(
  message: Message,
  source: ChatTimelineSource,
): message is ChatTimelineItem {
  const existing = message as Partial<ChatTimelineItem>;
  return existing.source === source
    && typeof existing.visual_root_created_at === "string"
    && existing.visual_root_created_at.length > 0
    && typeof existing.visual_root_id === "string"
    && existing.visual_root_id.length > 0
    && (existing.visual_depth === 0 || existing.visual_depth === 1)
    && (source !== "dm" || message.dm === true);
}

function normalizeSourceItems(
  source: ChatTimelineSource,
  messages: Message[],
): ChatTimelineItem[] {
  let byId: Map<string, Message> | null = null;

  return messages.map((message) => {
    if (isCanonicalTimelineItem(message, source)) {
      return message as ChatTimelineItem;
    }

    byId ||= new Map(messages.map((candidate) => [candidate.id, candidate]));
    let root = message;
    const visited = new Set([message.id]);
    while (root.reply_to) {
      const parent = byId.get(root.reply_to);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      root = parent;
    }

    return {
      ...message,
      source,
      visual_root_created_at: root.created_at,
      visual_root_id: root.id,
      visual_depth: message.reply_to ? 1 : 0,
      dm: source === "dm" ? true : message.dm,
    };
  });
}

function normalizeIncomingTimelineItems(
  source: ChatTimelineSource,
  messages: Message[],
  existingItems: ChatTimelineItem[],
): ChatTimelineItem[] {
  const knownById = new Map<string, Message>();
  const existingById = new Map<string, ChatTimelineItem>();
  for (const item of existingItems) {
    if (item.source !== source) continue;
    knownById.set(item.id, item);
    existingById.set(item.id, item);
  }
  for (const message of messages) knownById.set(message.id, message);

  const normalizedById = new Map<string, ChatTimelineItem>();
  for (const message of messages) {
    if (isCanonicalTimelineItem(message, source)) {
      normalizedById.set(message.id, message);
      continue;
    }

    const existing = existingById.get(message.id);
    if (existing) {
      normalizedById.set(message.id, {
        ...message,
        source,
        visual_root_created_at: existing.visual_root_created_at,
        visual_root_id: existing.visual_root_id,
        visual_depth: existing.visual_depth,
        dm: source === "dm" ? true : message.dm,
      });
      continue;
    }

    let root: Message = message;
    let parentId = message.reply_to;
    const visitedIds = new Set<string>([message.id]);
    while (parentId) {
      if (visitedIds.has(parentId)) break;
      visitedIds.add(parentId);
      const parent = knownById.get(parentId);
      if (!parent) break;
      if (isCanonicalTimelineItem(parent, source)) {
        normalizedById.set(message.id, {
          ...message,
          source,
          visual_root_created_at: parent.visual_root_created_at,
          visual_root_id: parent.visual_root_id,
          visual_depth: message.reply_to ? 1 : 0,
          dm: source === "dm" ? true : message.dm,
        });
        root = parent;
        break;
      }
      root = parent;
      parentId = parent.reply_to;
    }
    if (normalizedById.has(message.id)) continue;

    normalizedById.set(message.id, {
      ...message,
      source,
      visual_root_created_at: root.created_at,
      visual_root_id: root.id,
      visual_depth: message.reply_to ? 1 : 0,
      dm: source === "dm" ? true : message.dm,
    });
  }

  return [...normalizedById.values()].sort(compareTimelineItems);
}

function mergeSortedTimelineItems(
  existing: ChatTimelineItem[],
  incoming: ChatTimelineItem[],
): ChatTimelineItem[] {
  const merged: ChatTimelineItem[] = [];
  let existingIndex = 0;
  let incomingIndex = 0;

  while (existingIndex < existing.length && incomingIndex < incoming.length) {
    if (compareTimelineItems(existing[existingIndex], incoming[incomingIndex]) <= 0) {
      merged.push(existing[existingIndex++]);
    } else {
      merged.push(incoming[incomingIndex++]);
    }
  }
  if (existingIndex < existing.length) merged.push(...existing.slice(existingIndex));
  if (incomingIndex < incoming.length) merged.push(...incoming.slice(incomingIndex));
  return merged;
}

function timelineIdentity(source: ChatTimelineSource, id: string): string {
  return `${source}:${id}`;
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

export function upsertChatTimelineItems(
  state: ChatTimelineState,
  source: ChatTimelineSource,
  messages: Message[],
): ChatTimelineState {
  if (messages.length === 0) return state;
  const incomingIds = new Set(messages.map((message) => message.id));
  const incomingClientIds = new Set(
    messages
      .map((message) => message.client_message_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  if (state.mode === "legacy") {
    const previous = source === "message" ? state.messages : state.dmMessages;
    const byId = new Map(
      previous
        .filter((message) =>
          !message.client_message_id
          || !incomingClientIds.has(message.client_message_id)
          || incomingIds.has(message.id)
        )
        .map((message) => [message.id, message]),
    );
    for (const message of messages) byId.set(message.id, message);
    const next = [...byId.values()];
    return source === "message"
      ? { ...state, messages: next }
      : { ...state, dmMessages: next };
  }

  const incoming = normalizeIncomingTimelineItems(source, messages, state.timelineItems);
  const existing = state.timelineItems.filter((item) =>
    item.source !== source
    || (
      !incomingIds.has(item.id)
      && (
        !item.client_message_id
        || !incomingClientIds.has(item.client_message_id)
      )
    )
  );
  return {
    ...state,
    timelineItems: mergeSortedTimelineItems(existing, incoming),
  };
}

export function removeChatTimelineItems(
  state: ChatTimelineState,
  identities: ReadonlyArray<ChatTimelineIdentity>,
): ChatTimelineState {
  if (identities.length === 0) return state;
  const identitySet = new Set(
    identities.map((identity) => timelineIdentity(identity.source, identity.id)),
  );
  if (state.mode === "legacy") {
    return {
      mode: "legacy",
      messages: state.messages.filter((message) =>
        !identitySet.has(timelineIdentity("message", message.id))
      ),
      dmMessages: state.dmMessages.filter((message) =>
        !identitySet.has(timelineIdentity("dm", message.id))
      ),
    };
  }

  const timelineItems = state.timelineItems.filter((item) =>
    !identitySet.has(timelineIdentity(item.source, item.id))
  );
  return timelineItems.length === state.timelineItems.length
    ? state
    : { ...state, timelineItems };
}

export function removeChatTimelineThread(
  state: ChatTimelineState,
  source: ChatTimelineSource,
  rootId: string,
): ChatTimelineState {
  if (state.mode === "legacy") {
    const removeThread = (message: Message) =>
      message.id !== rootId && message.reply_to !== rootId;
    return source === "message"
      ? { ...state, messages: state.messages.filter(removeThread) }
      : { ...state, dmMessages: state.dmMessages.filter(removeThread) };
  }

  const timelineItems = state.timelineItems.filter((item) =>
    item.source !== source || item.visual_root_id !== rootId
  );
  return timelineItems.length === state.timelineItems.length
    ? state
    : { ...state, timelineItems };
}

export function restoreChatTimelineItems(
  state: ChatTimelineState,
  items: ReadonlyArray<ChatTimelineMutationItem>,
): ChatTimelineState {
  if (items.length === 0) return state;
  const messageItems = items
    .filter((item) => item.source === "message")
    .map((item) => item.message);
  const dmItems = items
    .filter((item) => item.source === "dm")
    .map((item) => item.message);
  return upsertChatTimelineItems(
    upsertChatTimelineItems(state, "message", messageItems),
    "dm",
    dmItems,
  );
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
