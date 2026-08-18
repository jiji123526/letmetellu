import type { UserLocale } from "../lib/channel-moderation.ts";
import type { UnifiedTimelineItem } from "../lib/unified-timeline-reader.ts";
import type { Env } from "../types.ts";
import { hydrateReportInboxMessages } from "./channel-reports.ts";

export interface ReportTimelineHydrationComparison {
  matches: boolean;
  before: string[];
  after: string[];
}

function itemKey(item: Pick<UnifiedTimelineItem, "source" | "id">): string {
  return `${item.source}:${item.id}`;
}

export function compareReportTimelineHydration(
  before: Array<Pick<UnifiedTimelineItem, "source" | "id">>,
  after: Array<Pick<UnifiedTimelineItem, "source" | "id">>,
): ReportTimelineHydrationComparison {
  const beforeKeys = before.map(itemKey);
  const afterKeys = after.map(itemKey);
  return {
    matches: beforeKeys.length === afterKeys.length
      && beforeKeys.every((key, index) => key === afterKeys[index]),
    before: beforeKeys,
    after: afterKeys,
  };
}

export async function hydrateUnifiedReportTimeline(
  items: UnifiedTimelineItem[],
  env: Env,
  locale: UserLocale,
): Promise<UnifiedTimelineItem[]> {
  const messageItems = items.filter((item) => item.source === "message");
  if (messageItems.length === 0) return items;

  const hydratedMessages = await hydrateReportInboxMessages(messageItems, env, locale);
  const hydratedById = new Map(hydratedMessages.map((item) => [item.id, item]));
  const hydrated = items.map((item) => (
    item.source === "message"
      ? hydratedById.get(item.id) || item
      : item
  ));
  const comparison = compareReportTimelineHydration(items, hydrated);
  if (!comparison.matches) {
    console.error(JSON.stringify({
      event_type: "unified_reports_hydration_mismatch",
      before_count: comparison.before.length,
      after_count: comparison.after.length,
    }));
    throw new Error("Unified reports hydration changed timeline identity or order");
  }
  return hydrated;
}
