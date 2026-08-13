import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const supportRouteSource = readFileSync(
  new URL("../src/routes/support.ts", import.meta.url),
  "utf8",
);
const supportInvariantMigration = readFileSync(
  new URL("../migrations/0038_support_open_lifecycle_invariants.sql", import.meta.url),
  "utf8",
);

test("support lifecycle schema permits only one open session and ticket per user", () => {
  assert.match(
    supportInvariantMigration,
    /CREATE UNIQUE INDEX IF NOT EXISTS support_sessions_one_open_per_user_idx[\s\S]*ON support_sessions\(user_id\)[\s\S]*WHERE status = 'open'/,
  );
  assert.match(
    supportInvariantMigration,
    /CREATE UNIQUE INDEX IF NOT EXISTS support_threads_one_open_per_user_idx[\s\S]*ON support_threads\(user_id\)[\s\S]*WHERE status = 'open'/,
  );
});

test("concurrent support starts and escalations recover the winning open record", () => {
  assert.match(
    supportRouteSource,
    /fetchOpenSupportThreadForUser\(input\.userId, input\.env\)[\s\S]*fetchSupportSessionById\(input\.session\.id, input\.env\)[\s\S]*latestSession\?\.status !== "open"[\s\S]*buildOpenSupportThreadResponse/,
  );
  assert.match(
    supportRouteSource,
    /catch \(error\) \{[\s\S]*fetchOpenSupportSessionForUser\(subjectId, env\)[\s\S]*serializeSession\(concurrentSession, locale\)/,
  );
  assert.match(
    supportRouteSource,
    /UPDATE support_sessions[\s\S]*WHERE id = \? AND status = 'open'/,
  );
});
