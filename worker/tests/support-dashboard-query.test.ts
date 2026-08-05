import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const supportRouteSource = readFileSync(
  new URL("../src/routes/support.ts", import.meta.url),
  "utf8",
);
const supportIndexMigration = readFileSync(
  new URL("../migrations/0031_support_dashboard_query_indexes.sql", import.meta.url),
  "utf8",
);

test("support thread reads use direct role-keyed joins", () => {
  assert.match(
    supportRouteSource,
    /LEFT JOIN support_thread_reads ur ON ur\.thread_id = st\.id AND ur\.actor_role = 'user'/,
  );
  assert.match(
    supportRouteSource,
    /LEFT JOIN support_thread_reads ar ON ar\.thread_id = st\.id AND ar\.actor_role = 'platform_admin'/,
  );
  assert.doesNotMatch(
    supportRouteSource,
    /SELECT read_at\s+FROM support_thread_reads/,
  );
});

test("support dashboard indexes cover pagination and both message lookup orders", () => {
  assert.match(
    supportIndexMigration,
    /support_threads\(status, updated_at DESC, id DESC\)/,
  );
  assert.match(
    supportIndexMigration,
    /support_messages\(thread_id, created_at DESC, id DESC, sender_role\)/,
  );
  assert.match(
    supportIndexMigration,
    /support_messages\(thread_id, sender_role, created_at DESC, id DESC\)/,
  );
  assert.match(supportIndexMigration, /DROP INDEX IF EXISTS support_threads_status_updated_idx/);
  assert.match(supportIndexMigration, /DROP INDEX IF EXISTS support_messages_thread_idx/);
});
