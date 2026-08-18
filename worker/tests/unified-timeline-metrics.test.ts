import assert from "node:assert/strict";
import test from "node:test";
import {
  createUnifiedTimelineMetricRecord,
} from "../src/lib/unified-timeline-metrics.ts";

function metrics(itemCount: number) {
  return {
    queryCount: 4,
    rowsRead: 120,
    d1DurationMs: 3.25,
    rootCount: 50,
    itemCount,
    maxChildrenPerRoot: 18,
    messageRootCount: 30,
    dmRootCount: 20,
    messageReplyCount: 40,
    dmReplyCount: 20,
  };
}

test("unified timeline metrics separate owner and visitor read scopes", () => {
  const record = createUnifiedTimelineMetricRecord({
    metrics: metrics(110),
    owner: false,
    readMode: "page",
    workerDurationMs: 12.345,
  });

  assert.equal(record.event_type, "unified_timeline_read");
  assert.equal(record.viewer_scope, "visitor");
  assert.equal(record.read_mode, "page");
  assert.equal(record.worker_duration_ms, 12.35);
  assert.equal(record.rowsRead, 120);
});

test("expanded pages above the provisional budget become fanout warnings", () => {
  const atBudget = createUnifiedTimelineMetricRecord({
    metrics: metrics(300),
    owner: true,
    readMode: "context",
    workerDurationMs: 10,
  });
  const aboveBudget = createUnifiedTimelineMetricRecord({
    metrics: metrics(301),
    owner: true,
    readMode: "context",
    workerDurationMs: 10,
  });

  assert.equal(atBudget.event_type, "unified_timeline_read");
  assert.equal(aboveBudget.event_type, "unified_timeline_fanout_warning");
  assert.equal(aboveBudget.viewer_scope, "owner");
});
