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
  blockedUsers: ReadonlyArray<{ uid: string }>;
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
  blockedUidSet: Set<string>;
  reportedTargetIds: Set<string>;
  threadedMessages: ThreadedMessages;
}

export function hasReportsInboxContent(messages: Message[]): boolean {
  return messages.some((message) => !!message.report_meta || !!message.petition_meta);
}

export function getDisplayMessages(
  messages: Message[],
  dmMessages: Message[],
  effectiveAdmin: boolean,
  isReportsOwnerView: boolean,
  reportsOwnerFilter: ReportsOwnerFilter,
): Message[] {
  if (!effectiveAdmin) return messages.filter((message) => !message.report);
  const adminMessages = [...messages, ...dmMessages];
  if (!isReportsOwnerView) {
    return adminMessages.sort((left, right) => (left.created_at || "").localeCompare(right.created_at || ""));
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
  const messageIds = new Set(displayMessages.map((message) => message.id));

  for (const message of displayMessages) {
    if (!message.reply_to) {
      topLevel.push(message);
    } else if (messageIds.has(message.reply_to)) {
      if (!repliesMap[message.reply_to]) repliesMap[message.reply_to] = [];
      repliesMap[message.reply_to].push(message);
    } else if (
      unavailableReplyParentIds.has(message.reply_to)
      || knownMessageIds.has(message.reply_to)
    ) {
      topLevel.push(message);
    }
  }

  return { topLevel, repliesMap };
}

export function deriveChatMessageCollections({
  messages,
  dmMessages,
  blockedUsers,
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
  );
  const knownMessageIds = new Set(
    [...messages, ...dmMessages].map((message) => message.id),
  );

  return {
    hasReportsInboxContent: reportsInboxContent,
    isReportsOwnerView: reportsOwnerView,
    displayMessages: nextDisplayMessages,
    restrictedChannels: getRestrictedChannels(nextDisplayMessages, reportsOwnerView),
    blockedUidSet: new Set(blockedUsers.map((blockedUser) => blockedUser.uid)),
    reportedTargetIds: getReportedTargetIds(nextDisplayMessages, effectiveAdmin),
    threadedMessages: getThreadedMessages(
      nextDisplayMessages,
      unavailableReplyParentIds,
      knownMessageIds,
    ),
  };
}
