import {
  UNIFIED_TIMELINE_FANOUT_WARNING_ITEMS,
  type UnifiedTimelineReadMetrics,
} from "./unified-timeline-reader.ts";

export interface UnifiedTimelineMetricRecord extends UnifiedTimelineReadMetrics {
  event_type: "unified_timeline_read" | "unified_timeline_fanout_warning";
  viewer_scope: "owner" | "visitor";
  read_mode: "page" | "context";
  worker_duration_ms: number;
}

export function createUnifiedTimelineMetricRecord(input: {
  metrics: UnifiedTimelineReadMetrics;
  owner: boolean;
  readMode: "page" | "context";
  workerDurationMs: number;
}): UnifiedTimelineMetricRecord {
  return {
    event_type: input.metrics.itemCount > UNIFIED_TIMELINE_FANOUT_WARNING_ITEMS
      ? "unified_timeline_fanout_warning"
      : "unified_timeline_read",
    viewer_scope: input.owner ? "owner" : "visitor",
    read_mode: input.readMode,
    worker_duration_ms: Math.round(input.workerDurationMs * 100) / 100,
    ...input.metrics,
  };
}

export function logUnifiedTimelineMetric(
  record: UnifiedTimelineMetricRecord,
): void {
  const serialized = JSON.stringify(record);
  if (record.event_type === "unified_timeline_fanout_warning") {
    console.warn(serialized);
  } else {
    console.info(serialized);
  }
}
