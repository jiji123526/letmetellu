import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mutationSource = readFileSync(
  new URL("../../src/components/chat/useChatMessageMutations.ts", import.meta.url),
  "utf8",
);
const contextSource = readFileSync(
  new URL("../../src/components/chat/useChatContextMenuActions.ts", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src/lib/api-chat.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL("../migrations/0046_server_backed_admin_delete_undo.sql", import.meta.url),
  "utf8",
);
const lifecycleSource = readFileSync(
  new URL("../src/lib/pending-admin-deletions.ts", import.meta.url),
  "utf8",
);
const adminSource = readFileSync(
  new URL("../src/routes/admin.ts", import.meta.url),
  "utf8",
);
const maintenanceSource = readFileSync(
  new URL("../src/lib/maintenance.ts", import.meta.url),
  "utf8",
);
const visibleMessagesSource = readFileSync(
  new URL("../src/lib/visible-messages.ts", import.meta.url),
  "utf8",
);
const dmThreadsSource = readFileSync(
  new URL("../src/lib/dm-threads.ts", import.meta.url),
  "utf8",
);

test("owner deletion stages immediately and exposes server-backed undo", () => {
  for (const source of [mutationSource, contextSource]) {
    assert.doesNotMatch(source, /pendingAdminDeleteRef/);
    assert.match(source, /adminAction\("delete-(?:message|dm)/);
    assert.match(source, /adminAction\(\s*"undo-delete"/);
    assert.match(source, /actionLabel: text\.undo/);
    assert.match(source, /onAction: undo/);
    assert.match(source, /\{ keepalive: true \}/);
    assert.match(source, /restoreDeletedMessages/);
  }
  assert.match(apiSource, /options\?: \{ keepalive\?: boolean \}/);
  assert.match(apiSource, /keepalive: options\?\.keepalive/);
});

test("pending deletion state is durable, hidden and finalized after expiry", () => {
  assert.match(migrationSource, /CREATE TABLE pending_admin_deletions/);
  assert.match(migrationSource, /ALTER TABLE dm ADD COLUMN pending_delete_at/);
  assert.match(migrationSource, /ALTER TABLE dm_replies ADD COLUMN pending_delete_at/);
  assert.match(lifecycleSource, /ADMIN_DELETE_UNDO_MS = 5_000/);
  assert.match(lifecycleSource, /UPDATE messages SET deleted = 2/);
  assert.match(lifecycleSource, /expires_at > \?/);
  assert.match(adminSource, /case "undo-delete"/);
  assert.match(maintenanceSource, /finalizeExpiredAdminDeletions/);
  assert.match(visibleMessagesSource, /AND deleted != 2/);
  assert.match(dmThreadsSource, /pending_delete_at IS NULL/);
  assert.match(lifecycleSource, /SELECT id, image FROM dm_replies WHERE dm_id = \?/);
  assert.match(lifecycleSource, /deleteUploadTicketByAttachment\(env, "dm", reply\.id\)/);
  assert.match(lifecycleSource, /deleteUploadTicketByAttachment\(env, "dm", row\.root_id\)/);
});
