import type { PrivateDmMessage } from "./dm-threads.ts";
import {
  compareUnifiedTimelineCursor,
  type UnifiedTimelineCursor,
  type UnifiedTimelineSource,
} from "./unified-timeline.ts";
import type { UnifiedTimelinePage } from "./unified-timeline-reader.ts";
import type { VisibleMessageRow } from "./visible-messages.ts";

interface ShadowRoot {
  id: string;
  source: UnifiedTimelineSource;
  createdAt: string;
}

export interface UnifiedTimelineShadowComparison {
  matches: boolean;
  legacyRootCount: number;
  unifiedRootCount: number;
  firstMismatchIndex: number | null;
  legacySourceAtMismatch: UnifiedTimelineSource | null;
  unifiedSourceAtMismatch: UnifiedTimelineSource | null;
}

function cursorForRoot(root: ShadowRoot): UnifiedTimelineCursor {
  return {
    visual_root_created_at: root.createdAt,
    source: root.source,
    visual_root_id: root.id,
    visual_depth: 0,
    created_at: root.createdAt,
    id: root.id,
  };
}

export function compareUnifiedTimelineShadow(input: {
  publicMessages: VisibleMessageRow[];
  dmMessages: PrivateDmMessage[];
  unifiedPage: UnifiedTimelinePage;
  limit: number;
}): UnifiedTimelineShadowComparison {
  const legacyRoots: ShadowRoot[] = [
    ...input.publicMessages
      .filter((message) => !message.reply_to)
      .map((message) => ({
        id: String(message.id),
        source: "message" as const,
        createdAt: String(message.created_at),
      })),
    ...input.dmMessages
      .filter((message) => !message.reply_to)
      .map((message) => ({
        id: String(message.id),
        source: "dm" as const,
        createdAt: String(message.created_at),
      })),
  ]
    .sort((left, right) => compareUnifiedTimelineCursor(cursorForRoot(left), cursorForRoot(right)))
    .slice(-input.limit);
  const unifiedRoots = input.unifiedPage.items
    .filter((item) => item.visual_depth === 0)
    .map((item) => ({ id: item.id, source: item.source }));

  const comparableLength = Math.max(legacyRoots.length, unifiedRoots.length);
  let firstMismatchIndex: number | null = null;
  for (let index = 0; index < comparableLength; index += 1) {
    if (
      legacyRoots[index]?.id !== unifiedRoots[index]?.id
      || legacyRoots[index]?.source !== unifiedRoots[index]?.source
    ) {
      firstMismatchIndex = index;
      break;
    }
  }

  return {
    matches: firstMismatchIndex === null,
    legacyRootCount: legacyRoots.length,
    unifiedRootCount: unifiedRoots.length,
    firstMismatchIndex,
    legacySourceAtMismatch: firstMismatchIndex === null
      ? null
      : legacyRoots[firstMismatchIndex]?.source || null,
    unifiedSourceAtMismatch: firstMismatchIndex === null
      ? null
      : unifiedRoots[firstMismatchIndex]?.source || null,
  };
}
