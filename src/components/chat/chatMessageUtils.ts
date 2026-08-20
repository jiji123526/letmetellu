export interface ChatMessageSnapshot {
  id: string;
  client_message_id?: string | null;
  uid: string;
  auth_uid?: string | null;
  nick: string | null;
  text: string;
  is_admin: number;
  image: string | null;
  image_w?: number | null;
  image_h?: number | null;
  reactions: string;
  reply_to: string | null;
  created_at: string;
  channel_id?: string;
  dm?: boolean;
  deleted?: boolean;
  edited?: boolean;
  report?: number;
  reported_msg_id?: string;
  report_meta?: unknown;
  petition_meta?: unknown;
  protected_sender?: boolean;
}

export const LIVE_WARNING_THRESHOLDS_MS = [60 * 60 * 1000, 30 * 60 * 1000, 10 * 60 * 1000, 5 * 60 * 1000] as const;
export const MAX_MOUNTED_HISTORY_MESSAGES = 300;

function resolveVisibleRootId<T extends Pick<ChatMessageSnapshot, "id" | "reply_to">>(
  message: T,
  messagesById: Map<string, T>,
): string {
  let current = message;
  let rootId = message.id;
  const visitedIds = new Set<string>([message.id]);

  while (current.reply_to) {
    const parent = messagesById.get(current.reply_to);
    if (!parent || visitedIds.has(parent.id)) break;
    visitedIds.add(parent.id);
    rootId = parent.id;
    current = parent;
  }

  return rootId;
}

export function trimMessageWindow<T extends Pick<ChatMessageSnapshot, "id" | "reply_to" | "created_at">>(
  messages: T[],
  edgeToKeep: "older" | "newer",
): T[] {
  if (messages.length <= MAX_MOUNTED_HISTORY_MESSAGES) return messages;
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const groups = new Map<string, T[]>();
  for (const message of messages) {
    const rootId = resolveVisibleRootId(message, messagesById);
    const group = groups.get(rootId);
    if (group) {
      group.push(message);
    } else {
      groups.set(rootId, [message]);
    }
  }

  const orderedGroups = [...groups.entries()].sort(([, left], [, right]) => {
    const leftRoot = left.find((message) => !message.reply_to) || left[0];
    const rightRoot = right.find((message) => !message.reply_to) || right[0];
    return leftRoot.created_at.localeCompare(rightRoot.created_at)
      || leftRoot.id.localeCompare(rightRoot.id);
  });
  const groupsFromKeptEdge = edgeToKeep === "older"
    ? orderedGroups
    : [...orderedGroups].reverse();
  const selectedRootIds = new Set<string>();
  let selectedMessageCount = 0;

  for (const [rootId, group] of groupsFromKeptEdge) {
    if (
      selectedRootIds.size > 0
      && selectedMessageCount + group.length > MAX_MOUNTED_HISTORY_MESSAGES
    ) break;
    selectedRootIds.add(rootId);
    selectedMessageCount += group.length;
  }

  return messages.filter((message) =>
    selectedRootIds.has(resolveVisibleRootId(message, messagesById))
  );
}

export function formatLiveThresholdLabel(locale: "ko" | "en", thresholdMs: number): string {
  if (locale === "ko") {
    if (thresholdMs === 60 * 60 * 1000) return "1시간";
    if (thresholdMs === 30 * 60 * 1000) return "30분";
    if (thresholdMs === 10 * 60 * 1000) return "10분";
    return "5분";
  }
  if (thresholdMs === 60 * 60 * 1000) return "1 hour";
  if (thresholdMs === 30 * 60 * 1000) return "30 minutes";
  if (thresholdMs === 10 * 60 * 1000) return "10 minutes";
  return "5 minutes";
}

export function formatLiveCountdownClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function parseReactions(reactionsStr: string): Record<string, string> {
  try {
    const parsed = JSON.parse(reactionsStr);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function messagesEqual(left: ChatMessageSnapshot, right: ChatMessageSnapshot): boolean {
  return left.id === right.id
    && left.client_message_id === right.client_message_id
    && left.uid === right.uid
    && left.auth_uid === right.auth_uid
    && left.nick === right.nick
    && left.text === right.text
    && left.is_admin === right.is_admin
    && left.image === right.image
    && left.reactions === right.reactions
    && left.reply_to === right.reply_to
    && left.created_at === right.created_at
    && left.channel_id === right.channel_id
    && left.dm === right.dm
    && left.deleted === right.deleted
    && left.edited === right.edited
    && left.report === right.report
    && left.reported_msg_id === right.reported_msg_id
    && left.protected_sender === right.protected_sender
    && JSON.stringify(left.report_meta || null) === JSON.stringify(right.report_meta || null)
    && JSON.stringify(left.petition_meta || null) === JSON.stringify(right.petition_meta || null);
}

export function upsertAcknowledgedMessages<T extends ChatMessageSnapshot>(previous: T[], acknowledged: T[]): T[] {
  if (acknowledged.length === 0) return previous;

  const next = [...previous];
  const indexById = new Map(next.map((message, index) => [message.id, index]));
  let changed = false;

  for (const message of acknowledged) {
    const existingIndex = indexById.get(message.id);
    if (existingIndex === undefined) {
      indexById.set(message.id, next.length);
      next.push(message);
      changed = true;
      continue;
    }
    if (!messagesEqual(next[existingIndex], message)) {
      next[existingIndex] = message;
      changed = true;
    }
  }

  return changed ? next : previous;
}

export function mergeServerMessageSnapshot<T extends ChatMessageSnapshot>(previous: T[], incoming: T[]): T[] {
  if (previous.length === 0) return incoming;
  if (incoming.length === 0) return [];

  const incomingById = new Map(incoming.map((message) => [message.id, message]));
  const incomingRootIds = new Set(
    incoming.map((message) => resolveVisibleRootId(message, incomingById)),
  );
  const previousByIdForRoots = new Map(previous.map((message) => [message.id, message]));
  const previousById = new Map(previous.map((message) => [message.id, message]));
  const incomingIds = new Set(incoming.map((message) => message.id));
  const merged: T[] = [];

  // A latest snapshot owns only the root threads it contains. Preserve every
  // other mounted thread regardless of when one of its replies was created.
  for (const message of previous) {
    const rootId = resolveVisibleRootId(message, previousByIdForRoots);
    if (!incomingRootIds.has(rootId) || incomingIds.has(message.id)) {
      merged.push(message);
    }
  }

  const mergedById = new Map(merged.map((message) => [message.id, message]));
  for (const message of incoming) {
    const previousMessage = previousById.get(message.id);
    mergedById.set(
      message.id,
      previousMessage && messagesEqual(previousMessage, message)
        ? previousMessage
        : message,
    );
  }

  return [...mergedById.values()].sort((left, right) =>
    (left.created_at || "").localeCompare(right.created_at || "")
  );
}

export function stripInboxChannelLine(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("채널: ") && !line.startsWith("Channel: "))
    .join("\n");
}
