import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reportsSource = readFileSync(new URL("../src/routes/channel-reports.ts", import.meta.url), "utf8");
const moderationSource = readFileSync(
  new URL("../../src/components/chat/useChatModeration.ts", import.meta.url),
  "utf8",
);
const realtimeSource = readFileSync(
  new URL("../../src/components/chat/useChatRealtimeSync.ts", import.meta.url),
  "utf8",
);

test("channel moderation returns every synchronized report inbox update", () => {
  assert.match(
    reportsSource,
    /async function syncChannelReportInboxMessages[\s\S]*Promise<Array<\{ message_id: string; report: ReportMeta; message_text: string \}>>/,
  );
  assert.match(
    reportsSource,
    /report_updates: reportUpdates/g,
  );
});

test("terminal report and petition transitions use conditional updates", () => {
  assert.match(
    reportsSource,
    /UPDATE channel_reports[\s\S]*WHERE id = \? AND status = 'open'[\s\S]*if \(!updateResult\.meta\.changes\)[\s\S]*report_already_processed/,
  );
  assert.match(
    reportsSource,
    /UPDATE channel_petitions[\s\S]*WHERE id = \? AND status = 'open'[\s\S]*if \(!updateResult\.meta\.changes\)[\s\S]*petition_already_processed/,
  );
});

test("the acting reports inbox applies all returned updates immediately", () => {
  assert.match(moderationSource, /const applyReportInboxUpdates = useCallback/);
  assert.match(moderationSource, /new Map\(updates\.map\(\(update\) => \[update\.message_id, update\]\)\)/);
  assert.match(moderationSource, /applyReportInboxUpdates\(result\.report_updates\)/);
});

test("channel owners refresh authoritative moderation after realtime changes", () => {
  assert.match(
    realtimeSource,
    /event\.type === "moderation-state-change"[\s\S]*if \(isOwner\) refreshOwnerModeration\(\)/,
  );
});
