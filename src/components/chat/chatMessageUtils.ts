export interface ChatMessageSnapshot {
  id: string;
  uid: string;
  auth_uid?: string | null;
  nick: string | null;
  text: string;
  is_admin: number;
  image: string | null;
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
  const selected = edgeToKeep === "older"
    ? messages.slice(0, MAX_MOUNTED_HISTORY_MESSAGES)
    : messages.slice(-MAX_MOUNTED_HISTORY_MESSAGES);
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const rootIdsByMessageId = new Map<string, string>();
  for (const message of messages) {
    rootIdsByMessageId.set(message.id, resolveVisibleRootId(message, messagesById));
  }

  // Keep whole visible root-thread groups mounted so sibling replies are not
  // selectively dropped when the chronological cut lands in the middle of a thread.
  const selectedRootIds = new Set(
    selected.map((message) => rootIdsByMessageId.get(message.id) || message.id),
  );

  return messages.filter((message) =>
    selectedRootIds.has(rootIdsByMessageId.get(message.id) || message.id)
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

export function mergeServerMessageSnapshot<T extends ChatMessageSnapshot>(previous: T[], incoming: T[]): T[] {
  if (previous.length === 0) return incoming;
  if (incoming.length === 0) return [];

  const previousById = new Map(previous.map((message) => [message.id, message]));
  const incomingIds = new Set(incoming.map((message) => message.id));
  const oldestIncomingTime = incoming[0]?.created_at || "";
  const merged: T[] = [];

  // Preserve locally loaded history older than the server snapshot. Within the
  // snapshot window, absence means the server deleted the message.
  for (const message of previous) {
    if (message.created_at < oldestIncomingTime || incomingIds.has(message.id)) {
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
