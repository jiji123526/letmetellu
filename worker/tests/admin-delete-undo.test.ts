import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADMIN_DELETE_ID_CHUNK_SIZE,
  ADMIN_DELETE_UNDO_MS,
  finalizeExpiredAdminDeletions,
  stageMessageDeletion,
  undoPendingDeletion,
} from "../src/lib/pending-admin-deletions.ts";
import type { Env } from "../src/types.ts";

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

test("large message threads use bounded staging and grouped Undo statements", async () => {
  const states = Array.from({ length: 205 }, (_, index) => ({
    id: index === 0 ? "root-a" : `reply-${index}`,
    deleted: index % 2,
  }));
  const batches: Array<Array<{ sql: string; params: unknown[] }>> = [];
  const boundStatements: Array<{ sql: string; params: unknown[] }> = [];
  let pendingRow: Record<string, unknown> | null = null;

  function statement(sqlText: string, params: unknown[] = []) {
    const sql = sqlText.replace(/\s+/g, " ").trim();
    return {
      bind(...nextParams: unknown[]) {
        boundStatements.push({ sql, params: nextParams });
        return statement(sql, nextParams);
      },
      async all() {
        if (sql.includes("SELECT id, deleted FROM messages")) return { results: states };
        if (sql.includes("FROM pending_admin_deletions") && sql.includes("expires_at <= ?")) {
          return { results: pendingRow ? [pendingRow] : [] };
        }
        if (sql.includes("SELECT id, image, gallery_id FROM messages")) {
          return {
            results: params.slice(1).map((id) => ({ id, image: null, gallery_id: null })),
          };
        }
        return { results: [] };
      },
      async first() {
        if (sql.includes("FROM pending_admin_deletions")) return pendingRow;
        return null;
      },
      async run() {
        if (sql.includes("INSERT INTO pending_admin_deletions")) {
          pendingRow = {
            id: params[0],
            channel_id: params[1],
            owner_uid: params[2],
            record_type: params[3],
            root_id: params[4],
            record_ids_json: params[5],
            previous_states_json: params[6],
            created_at: params[7],
            expires_at: params[8],
          };
        } else if (sql.includes("DELETE FROM pending_admin_deletions")) {
          pendingRow = null;
        }
        return { success: true, meta: { changes: 1 } };
      },
      sql,
      params,
    };
  }

  const env = {
    DB: {
      prepare: statement,
      async batch(items: Array<ReturnType<typeof statement>>) {
        batches.push(items.map((item) => ({ sql: item.sql, params: item.params })));
        return Promise.all(items.map((item) => item.run()));
      },
    },
    MEDIA: {
      async delete() {},
    },
  } as unknown as Env;

  const staged = await stageMessageDeletion(env, "channel-a", "owner-a", "root-a");
  assert.ok(staged);
  const restored = await undoPendingDeletion(env, "channel-a", "owner-a", staged.deletionId);
  assert.ok(restored);

  const [stageBatch, undoBatch] = batches;
  const stageUpdates = stageBatch.filter((item) => item.sql.startsWith("UPDATE messages SET deleted = 2"));
  const undoUpdates = undoBatch.filter((item) => item.sql.startsWith("UPDATE messages SET deleted = ?"));
  assert.equal(stageUpdates.length, Math.ceil(states.length / ADMIN_DELETE_ID_CHUNK_SIZE));
  assert.equal(undoUpdates.length, 4);
  assert.ok([...stageBatch, ...undoBatch].every((item) => item.params.length <= 100));
  assert.deepEqual(
    stageUpdates.flatMap((item) => item.params.slice(1)).sort(),
    states.map((state) => state.id).sort(),
  );
  assert.deepEqual(
    undoUpdates.flatMap((item) => item.params.slice(2)).sort(),
    states.map((state) => state.id).sort(),
  );

  const restaged = await stageMessageDeletion(env, "channel-a", "owner-a", "root-a");
  assert.ok(restaged);
  const finalized = await finalizeExpiredAdminDeletions(
    env,
    Date.now() + ADMIN_DELETE_UNDO_MS + 1_000,
  );
  assert.equal(finalized, 1);
  const finalizeBatch = batches.at(-1)!;
  assert.ok(finalizeBatch.some((item) => item.sql.includes("DELETE FROM upload_tickets")));
  assert.ok(finalizeBatch.every((item) => item.params.length <= 100));
  assert.ok(boundStatements.every((item) => item.params.length <= 100));
});
