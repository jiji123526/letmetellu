import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { UnifiedTimelineItem } from "../src/lib/unified-timeline-reader.ts";
import {
  compareReportTimelineHydration,
  hydrateUnifiedReportTimeline,
} from "../src/routes/report-timeline-adapter.ts";
import type { Env } from "../src/types.ts";

const migrationSource = readFileSync(
  new URL("../migrations/0048_channel_petition_inbox_lookup.sql", import.meta.url),
  "utf8",
);

function message(id: string, source: "message" | "dm" = "message"): UnifiedTimelineItem {
  return {
    id,
    source,
    created_at: "2026-08-18T00:00:00.000Z",
    visual_root_created_at: "2026-08-18T00:00:00.000Z",
    visual_root_id: id,
    visual_depth: 0,
  };
}

test("report timeline comparison detects identity or order changes", () => {
  const items = [message("a"), message("b")];
  assert.equal(compareReportTimelineHydration(items, [...items]).matches, true);
  assert.equal(compareReportTimelineHydration(items, [...items].reverse()).matches, false);
});

test("petition hydration has an inbox-message lookup index", () => {
  assert.match(
    migrationSource,
    /ON channel_petitions\(inbox_message_id\)/,
  );
});

test("large report pages use constant-shape hydration and leave DM items untouched", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const statement = (sql: string, params: unknown[] = []) => ({
    bind(...nextParams: unknown[]) {
      return statement(sql, nextParams);
    },
    async all() {
      calls.push({ sql, params });
      return { results: [] };
    },
  });
  const env = {
    DB: { prepare: statement },
  } as unknown as Env;
  const items = [
    ...Array.from({ length: 150 }, (_, index) => message(`message-${index}`)),
    message("private-dm", "dm"),
  ];

  const hydrated = await hydrateUnifiedReportTimeline(items, env, "ko");

  assert.deepEqual(hydrated.map((item) => `${item.source}:${item.id}`), items.map((item) => `${item.source}:${item.id}`));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.params.length === 1));
  const selectedIds = JSON.parse(String(calls[0].params[0])) as string[];
  assert.equal(selectedIds.length, 150);
  assert.equal(selectedIds.includes("private-dm"), false);
  assert.ok(calls.every((call) => call.sql.includes("json_each(?)")));
});
