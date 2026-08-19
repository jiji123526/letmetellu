import type { Message } from "./chatTypes";

export interface RestrictedChannelSummaryItem {
  channelId: string;
  channelName: string;
  channelUrl: string;
  moderationStatus: "suspended" | "frozen";
  hasOpenReport: boolean;
  hasOpenPetition: boolean;
  lastActivityAt: string;
}

export type ReportsOwnerFilter = "open" | "warned" | "frozen" | null;

export interface ThreadedMessages {
  topLevel: Message[];
  repliesMap: Record<string, Message[]>;
}

interface DeriveChatMessageCollectionsArgs {
  messages: Message[];
  dmMessages: Message[];
  historyMode: "latest" | "context";
  unavailableReplyParentIds: ReadonlySet<string>;
  effectiveAdmin: boolean;
  isReportsChannelView: boolean;
  reportsOwnerFilter: ReportsOwnerFilter;
}

interface DerivedChatMessageCollections {
  hasReportsInboxContent: boolean;
  isReportsOwnerView: boolean;
  displayMessages: Message[];
  restrictedChannels: RestrictedChannelSummaryItem[];
  reportedTargetIds: Set<string>;
  threadedMessages: ThreadedMessages;
}

export function hasReportsInboxContent(messages: Message[]): boolean {
  return messages.some((message) => !!message.report_meta || !!message.petition_meta);
}

export function getAnonymousViewerDmMessages(dmMessages: Message[], uid: string): Message[] {
  const ownRootIds = new Set(
    dmMessages
      .filter((message) => !message.reply_to && message.uid === uid)
      .map((message) => message.id),
  );
  return dmMessages.filter((message) =>
    ownRootIds.has(message.id)
    || (!!message.reply_to && ownRootIds.has(message.reply_to))
  );
}

function compareMessageChronology(left: Message, right: Message): number {
  return (left.created_at || "").localeCompare(right.created_at || "");
}

function isChronologicallySorted(messages: Message[]): boolean {
  for (let index = 1; index < messages.length; index += 1) {
    if (compareMessageChronology(messages[index - 1], messages[index]) > 0) return false;
  }
  return true;
}

function mergeChronologicalMessages(left: Message[], right: Message[]): Message[] {
  if (!isChronologicallySorted(left) || !isChronologicallySorted(right)) {
    return [...left, ...right].sort(compareMessageChronology);
  }

  const merged: Message[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (compareMessageChronology(left[leftIndex], right[rightIndex]) <= 0) {
      merged.push(left[leftIndex++]);
    } else {
      merged.push(right[rightIndex++]);
    }
  }
  if (leftIndex < left.length) merged.push(...left.slice(leftIndex));
  if (rightIndex < right.length) merged.push(...right.slice(rightIndex));
  return merged;
}

export function getDisplayMessages(
  messages: Message[],
  dmMessages: Message[],
  effectiveAdmin: boolean,
  isReportsOwnerView: boolean,
  reportsOwnerFilter: ReportsOwnerFilter,
  historyMode: "latest" | "context" = "latest",
): Message[] {
  if (!effectiveAdmin) {
    return mergeChronologicalMessages(
      messages.filter((message) => !message.report),
      dmMessages,
    );
  }
  const loadedMessageRange = messages.reduce<{
    oldest: string | null;
    newest: string | null;
  }>((range, message) => {
    if (!message.created_at) return range;
    return {
      oldest: !range.oldest || message.created_at.localeCompare(range.oldest) < 0
        ? message.created_at
        : range.oldest,
      newest: !range.newest || message.created_at.localeCompare(range.newest) > 0
        ? message.created_at
        : range.newest,
    };
  }, { oldest: null, newest: null });
  const visibleDmMessages = historyMode === "latest"
    ? dmMessages
    : loadedMessageRange.oldest
    ? dmMessages.filter((message) =>
        !message.created_at
        || (
          message.created_at.localeCompare(loadedMessageRange.oldest!) >= 0
          && (
            !loadedMessageRange.newest
            || message.created_at.localeCompare(loadedMessageRange.newest) <= 0
          )
        )
      )
    : dmMessages;
  const adminMessages = [...messages, ...visibleDmMessages];
  if (!isReportsOwnerView) {
    return mergeChronologicalMessages(messages, visibleDmMessages);
  }

  const orderedMessages = adminMessages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftOpenReport = left.message.report_meta?.status === "open" ? 1 : 0;
      const rightOpenReport = right.message.report_meta?.status === "open" ? 1 : 0;
      if (leftOpenReport !== rightOpenReport) return leftOpenReport - rightOpenReport;
      const timeCompare = (left.message.created_at || "").localeCompare(right.message.created_at || "");
      if (timeCompare !== 0) return timeCompare;
      return left.index - right.index;
    })
    .map(({ message }) => message);

  if (!reportsOwnerFilter) return orderedMessages;
  return orderedMessages.filter((message) => {
    const moderationStatus = message.report_meta?.moderation_status;
    if (reportsOwnerFilter === "open") {
      return message.report_meta?.status === "open";
    }
    if (reportsOwnerFilter === "warned") {
      return moderationStatus === "warned";
    }
    if (reportsOwnerFilter === "frozen") {
      return moderationStatus === "frozen";
    }
    return true;
  });
}

export function getRestrictedChannels(
  displayMessages: Message[],
  isReportsOwnerView: boolean,
): RestrictedChannelSummaryItem[] {
  if (!isReportsOwnerView) return [];
  const restrictedMap = new Map<string, RestrictedChannelSummaryItem>();

  for (const message of displayMessages) {
    const reportMeta = message.report_meta;
    const petitionMeta = message.petition_meta;
    const channelIdFromMeta = reportMeta?.channel_id || petitionMeta?.channel_id;
    if (!channelIdFromMeta) continue;

    const moderationStatus = reportMeta?.moderation_status;
    const isRestricted = moderationStatus === "suspended" || moderationStatus === "frozen";
    const existing = restrictedMap.get(channelIdFromMeta);
    const activityCandidates = [
      message.created_at,
      reportMeta?.resolved_at || "",
      petitionMeta?.resolved_at || "",
    ].filter(Boolean).sort();
    const nextActivityAt = activityCandidates[activityCandidates.length - 1] || "";

    if (!existing && !isRestricted) continue;
    if (!existing) {
      restrictedMap.set(channelIdFromMeta, {
        channelId: channelIdFromMeta,
        channelName: reportMeta?.channel_name || petitionMeta?.channel_name || channelIdFromMeta,
        channelUrl: reportMeta?.channel_url || petitionMeta?.channel_url || `/ch/${encodeURIComponent(channelIdFromMeta)}`,
        moderationStatus: moderationStatus as "suspended" | "frozen",
        hasOpenReport: reportMeta?.status === "open",
        hasOpenPetition: reportMeta?.petition_status === "open" || petitionMeta?.status === "open",
        lastActivityAt: nextActivityAt,
      });
      continue;
    }

    if (isRestricted) {
      existing.moderationStatus = moderationStatus;
    }
    if (reportMeta?.channel_name || petitionMeta?.channel_name) {
      existing.channelName = reportMeta?.channel_name || petitionMeta?.channel_name || existing.channelName;
    }
    if (reportMeta?.channel_url || petitionMeta?.channel_url) {
      existing.channelUrl = reportMeta?.channel_url || petitionMeta?.channel_url || existing.channelUrl;
    }
    existing.hasOpenReport = existing.hasOpenReport || reportMeta?.status === "open";
    existing.hasOpenPetition = existing.hasOpenPetition || reportMeta?.petition_status === "open" || petitionMeta?.status === "open";
    if ((existing.lastActivityAt || "").localeCompare(nextActivityAt) < 0) {
      existing.lastActivityAt = nextActivityAt;
    }
  }

  return [...restrictedMap.values()].sort((left, right) => {
    if (left.moderationStatus !== right.moderationStatus) {
      return left.moderationStatus === "frozen" ? -1 : 1;
    }
    return (right.lastActivityAt || "").localeCompare(left.lastActivityAt || "");
  });
}

export function getReportedTargetIds(displayMessages: Message[], effectiveAdmin: boolean): Set<string> {
  const ids = new Set<string>();
  if (!effectiveAdmin) return ids;
  for (const message of displayMessages) {
    if (message.report && message.reported_msg_id) ids.add(message.reported_msg_id);
  }
  return ids;
}

export function getThreadedMessages(
  displayMessages: Message[],
  unavailableReplyParentIds: ReadonlySet<string> = new Set(),
  knownMessageIds: ReadonlySet<string> = new Set(displayMessages.map((message) => message.id)),
): ThreadedMessages {
  const topLevel: Message[] = [];
  const repliesMap: Record<string, Message[]> = {};
  const messagesById = new Map(displayMessages.map((message) => [message.id, message]));

  function resolveRenderableParentId(message: Message): string | null | undefined {
    if (!message.reply_to) return null;

    let parentId: string | null = message.reply_to;
    let lastVisibleAncestorId: string | null = null;
    const visitedIds = new Set<string>([message.id]);

    while (parentId) {
      if (visitedIds.has(parentId)) return lastVisibleAncestorId;
      visitedIds.add(parentId);

      const parent = messagesById.get(parentId);
      if (!parent) {
        if (unavailableReplyParentIds.has(parentId) || knownMessageIds.has(parentId)) {
          return lastVisibleAncestorId;
        }
        return undefined;
      }

      lastVisibleAncestorId = parent.id;
      if (!parent.reply_to) return parent.id;
      parentId = parent.reply_to;
    }

    return lastVisibleAncestorId;
  }

  for (const message of displayMessages) {
    if (!message.reply_to) {
      topLevel.push(message);
      continue;
    }

    const renderParentId = resolveRenderableParentId(message);
    if (renderParentId === undefined) {
      continue;
    }

    if (renderParentId === null) {
      topLevel.push(message);
      continue;
    }

    if (!messagesById.has(renderParentId)) {
      topLevel.push(message);
      continue;
    }

    if (!repliesMap[renderParentId]) repliesMap[renderParentId] = [];
    repliesMap[renderParentId].push(message);
  }

  return { topLevel, repliesMap };
}

export function deriveChatMessageCollections({
  messages,
  dmMessages,
  historyMode,
  unavailableReplyParentIds,
  effectiveAdmin,
  isReportsChannelView,
  reportsOwnerFilter,
}: DeriveChatMessageCollectionsArgs): DerivedChatMessageCollections {
  const reportsInboxContent = hasReportsInboxContent(messages);
  const reportsOwnerView = effectiveAdmin && (isReportsChannelView || reportsInboxContent);
  const nextDisplayMessages = getDisplayMessages(
    messages,
    dmMessages,
    effectiveAdmin,
    reportsOwnerView,
    reportsOwnerFilter,
    historyMode,
  );
  const knownMessageIds = new Set(
    messages.map((message) => message.id),
  );
  for (const message of dmMessages) knownMessageIds.add(message.id);

  return {
    hasReportsInboxContent: reportsInboxContent,
    isReportsOwnerView: reportsOwnerView,
    displayMessages: nextDisplayMessages,
    restrictedChannels: getRestrictedChannels(nextDisplayMessages, reportsOwnerView),
    reportedTargetIds: getReportedTargetIds(nextDisplayMessages, effectiveAdmin),
    threadedMessages: getThreadedMessages(
      nextDisplayMessages,
      unavailableReplyParentIds,
      knownMessageIds,
    ),
  };
}
