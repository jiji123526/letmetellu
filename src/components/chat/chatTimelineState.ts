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
    };

export type MessageCollectionUpdate =
  | Message[]
  | ((previous: Message[]) => Message[]);

const SOURCE_RANK: Record<ChatTimelineSource, number> = {
  message: 0,
  dm: 1,
};

function compareTimelineItems(left: ChatTimelineItem, right: ChatTimelineItem): number {
  return left.visual_root_created_at.localeCompare(right.visual_root_created_at)
    || SOURCE_RANK[left.source] - SOURCE_RANK[right.source]
    || left.visual_root_id.localeCompare(right.visual_root_id)
    || left.visual_depth - right.visual_depth
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id);
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
  };
}

export function replaceUnifiedTimelinePage(
  state: ChatTimelineState,
  items: ChatTimelineItem[],
  pageStartCursor: UnifiedTimelineCursor | null,
  pageEndCursor: UnifiedTimelineCursor | null,
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
  };
}
