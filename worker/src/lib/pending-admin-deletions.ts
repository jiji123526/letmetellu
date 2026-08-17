import type { Env } from "../types.ts";
import { deleteMediaByUrl } from "./media.ts";
import { deleteUploadTicketByAttachment } from "./upload-tickets.ts";

export const ADMIN_DELETE_UNDO_MS = 5_000;

type PendingRecordType = "message" | "dm" | "dm_reply";

interface PendingDeletionRow {
  id: string;
  channel_id: string;
  owner_uid: string;
  record_type: PendingRecordType;
  root_id: string;
  record_ids_json: string;
  previous_states_json: string | null;
  created_at: string;
  expires_at: string;
}

interface MessageState {
  id: string;
  deleted: number;
}

export interface PendingDeletionResult {
  deletionId: string;
  expiresAt: string;
  recordType: PendingRecordType;
  rootId: string;
}

function parseIds(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id)) return [];
    return [...new Set(value)];
  } catch {
    return [];
  }
}

function parseMessageStates(raw: string | null): MessageState[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is MessageState => (
      !!entry
      && typeof entry.id === "string"
      && Number.isInteger(entry.deleted)
      && entry.deleted >= 0
      && entry.deleted <= 1
    ));
  } catch {
    return [];
  }
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

async function insertPendingDeletion(
  env: Env,
  input: {
    channelId: string;
    ownerUid: string;
    recordType: PendingRecordType;
    rootId: string;
    recordIds: string[];
    previousStates?: MessageState[];
    expiresAt?: string;
    updateStatements: D1PreparedStatement[];
  },
): Promise<PendingDeletionResult> {
  const deletionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = input.expiresAt || new Date(Date.now() + ADMIN_DELETE_UNDO_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO pending_admin_deletions (
        id, channel_id, owner_uid, record_type, root_id,
        record_ids_json, previous_states_json, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      deletionId,
      input.channelId,
      input.ownerUid,
      input.recordType,
      input.rootId,
      JSON.stringify(input.recordIds),
      input.previousStates ? JSON.stringify(input.previousStates) : null,
      createdAt,
      expiresAt,
    ),
    ...input.updateStatements,
  ]);
  return {
    deletionId,
    expiresAt,
    recordType: input.recordType,
    rootId: input.rootId,
  };
}

export async function stageMessageDeletion(
  env: Env,
  channelId: string,
  ownerUid: string,
  rootId: string,
): Promise<PendingDeletionResult | null> {
  const { results } = await env.DB.prepare(`
    SELECT id, deleted
    FROM messages
    WHERE channel_id = ? AND (id = ? OR reply_to = ?)
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at ASC, id ASC
  `).bind(channelId, rootId, rootId, rootId).all<MessageState>();
  const states = (results || []).filter((row) => row.deleted !== 2);
  if (!states.some((row) => row.id === rootId)) return null;
  const ids = states.map((row) => row.id);
  return insertPendingDeletion(env, {
    channelId,
    ownerUid,
    recordType: "message",
    rootId,
    recordIds: ids,
    previousStates: states.map((row) => ({ id: row.id, deleted: row.deleted })),
    updateStatements: [
      env.DB.prepare(
        `UPDATE messages SET deleted = 2 WHERE channel_id = ? AND id IN (${placeholders(ids)})`
      ).bind(channelId, ...ids),
    ],
  });
}

export async function stageDmDeletion(
  env: Env,
  channelId: string,
  ownerUid: string,
  dmId: string,
): Promise<PendingDeletionResult | null> {
  const root = await env.DB.prepare(
    "SELECT id FROM dm WHERE id = ? AND channel_id = ? AND pending_delete_at IS NULL"
  ).bind(dmId, channelId).first<{ id: string }>();
  if (!root) return null;
  const { results } = await env.DB.prepare(
    "SELECT id FROM dm_replies WHERE dm_id = ? AND channel_id = ? AND pending_delete_at IS NULL"
  ).bind(dmId, channelId).all<{ id: string }>();
  const replyIds = (results || []).map((row) => row.id);
  const recordIds = [dmId, ...replyIds];
  const expiresAt = new Date(Date.now() + ADMIN_DELETE_UNDO_MS).toISOString();
  return insertPendingDeletion(env, {
    channelId,
    ownerUid,
    recordType: "dm",
    rootId: dmId,
    recordIds,
    expiresAt,
    updateStatements: [
      env.DB.prepare(
        "UPDATE dm SET pending_delete_at = ? WHERE id = ? AND channel_id = ?"
      ).bind(expiresAt, dmId, channelId),
      env.DB.prepare(
        "UPDATE dm_replies SET pending_delete_at = ? WHERE dm_id = ? AND channel_id = ?"
      ).bind(expiresAt, dmId, channelId),
    ],
  });
}

export async function stageDmReplyDeletion(
  env: Env,
  channelId: string,
  ownerUid: string,
  replyId: string,
): Promise<PendingDeletionResult | null> {
  const reply = await env.DB.prepare(`
    SELECT id
    FROM dm_replies
    WHERE id = ? AND channel_id = ? AND owner_uid = ? AND pending_delete_at IS NULL
  `).bind(replyId, channelId, ownerUid).first<{ id: string }>();
  if (!reply) return null;
  const expiresAt = new Date(Date.now() + ADMIN_DELETE_UNDO_MS).toISOString();
  return insertPendingDeletion(env, {
    channelId,
    ownerUid,
    recordType: "dm_reply",
    rootId: replyId,
    recordIds: [replyId],
    expiresAt,
    updateStatements: [
      env.DB.prepare(
        "UPDATE dm_replies SET pending_delete_at = ? WHERE id = ? AND channel_id = ? AND owner_uid = ?"
      ).bind(expiresAt, replyId, channelId, ownerUid),
    ],
  });
}

export async function undoPendingDeletion(
  env: Env,
  channelId: string,
  ownerUid: string,
  deletionId: string,
  nowMs = Date.now(),
): Promise<PendingDeletionResult | null> {
  const row = await env.DB.prepare(`
    SELECT *
    FROM pending_admin_deletions
    WHERE id = ? AND channel_id = ? AND owner_uid = ? AND expires_at > ?
    LIMIT 1
  `).bind(deletionId, channelId, ownerUid, new Date(nowMs).toISOString())
    .first<PendingDeletionRow>();
  if (!row) return null;

  const ids = parseIds(row.record_ids_json);
  if (ids.length === 0) return null;
  const statements: D1PreparedStatement[] = [];
  if (row.record_type === "message") {
    const states = parseMessageStates(row.previous_states_json);
    if (states.length !== ids.length) return null;
    statements.push(...states.map((state) =>
      env.DB.prepare(
        "UPDATE messages SET deleted = ? WHERE id = ? AND channel_id = ? AND deleted = 2"
      ).bind(state.deleted, state.id, channelId)
    ));
  } else if (row.record_type === "dm") {
    statements.push(
      env.DB.prepare(
        "UPDATE dm SET pending_delete_at = NULL WHERE id = ? AND channel_id = ?"
      ).bind(row.root_id, channelId),
      env.DB.prepare(
        `UPDATE dm_replies SET pending_delete_at = NULL WHERE channel_id = ? AND id IN (${placeholders(ids.slice(1)) || "NULL"})`
      ).bind(channelId, ...ids.slice(1)),
    );
  } else {
    statements.push(
      env.DB.prepare(
        "UPDATE dm_replies SET pending_delete_at = NULL WHERE id = ? AND channel_id = ? AND owner_uid = ?"
      ).bind(row.root_id, channelId, ownerUid),
    );
  }
  statements.push(
    env.DB.prepare(
      "DELETE FROM pending_admin_deletions WHERE id = ? AND channel_id = ? AND owner_uid = ?"
    ).bind(deletionId, channelId, ownerUid),
  );
  await env.DB.batch(statements);
  return {
    deletionId: row.id,
    expiresAt: row.expires_at,
    recordType: row.record_type,
    rootId: row.root_id,
  };
}

async function finalizeMessageDeletion(env: Env, row: PendingDeletionRow, ids: string[]): Promise<void> {
  const { results } = await env.DB.prepare(`
    SELECT id, image, gallery_id
    FROM messages
    WHERE channel_id = ? AND id IN (${placeholders(ids)})
  `).bind(row.channel_id, ...ids).all<{ id: string; image: string | null; gallery_id: string | null }>();
  const records = results || [];
  const galleryIds = records.map((record) => record.gallery_id).filter((id): id is string => !!id);
  const childIds = ids.filter((id) => id !== row.root_id);
  const statements: D1PreparedStatement[] = [];
  if (galleryIds.length > 0) {
    statements.push(
      env.DB.prepare(`DELETE FROM gallery WHERE channel_id = ? AND id IN (${placeholders(galleryIds)})`)
        .bind(row.channel_id, ...galleryIds),
    );
  }
  statements.push(
    env.DB.prepare(`DELETE FROM message_links WHERE message_id IN (${placeholders(ids)})`).bind(...ids),
    env.DB.prepare(
      `DELETE FROM message_actor_identities WHERE record_type = 'message' AND record_id IN (${placeholders(ids)})`
    ).bind(...ids),
  );
  if (childIds.length > 0) {
    statements.push(
      env.DB.prepare(`DELETE FROM messages WHERE channel_id = ? AND id IN (${placeholders(childIds)})`)
        .bind(row.channel_id, ...childIds),
    );
  }
  statements.push(
    env.DB.prepare("DELETE FROM messages WHERE id = ? AND channel_id = ? AND deleted = 2")
      .bind(row.root_id, row.channel_id),
  );
  await env.DB.batch(statements);
  await Promise.all([
    ...ids.map((id) => deleteUploadTicketByAttachment(env, "message", id)),
    ...records.map((record) => deleteMediaByUrl(env, record.image)),
  ]);
}

async function finalizeDmDeletion(env: Env, row: PendingDeletionRow): Promise<void> {
  const dm = await env.DB.prepare(
    "SELECT image FROM dm WHERE id = ? AND channel_id = ?"
  ).bind(row.root_id, row.channel_id).first<{ image: string | null }>();
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM message_actor_identities WHERE record_id = ? AND record_type = 'dm'"
    ).bind(row.root_id),
    env.DB.prepare("DELETE FROM dm_replies WHERE dm_id = ? AND channel_id = ?")
      .bind(row.root_id, row.channel_id),
    env.DB.prepare("DELETE FROM dm WHERE id = ? AND channel_id = ? AND pending_delete_at IS NOT NULL")
      .bind(row.root_id, row.channel_id),
  ]);
  await deleteMediaByUrl(env, dm?.image);
  await deleteUploadTicketByAttachment(env, "dm", row.root_id);
}

export async function finalizeExpiredAdminDeletions(
  env: Env,
  nowMs = Date.now(),
  limit = 50,
): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT *
    FROM pending_admin_deletions
    WHERE expires_at <= ?
    ORDER BY expires_at ASC, id ASC
    LIMIT ?
  `).bind(new Date(nowMs).toISOString(), limit).all<PendingDeletionRow>();

  let finalized = 0;
  for (const row of results || []) {
    const ids = parseIds(row.record_ids_json);
    if (ids.length === 0) continue;
    if (row.record_type === "message") {
      await finalizeMessageDeletion(env, row, ids);
    } else if (row.record_type === "dm") {
      await finalizeDmDeletion(env, row);
    } else {
      await env.DB.prepare(
        "DELETE FROM dm_replies WHERE id = ? AND channel_id = ? AND owner_uid = ? AND pending_delete_at IS NOT NULL"
      ).bind(row.root_id, row.channel_id, row.owner_uid).run();
    }
    await env.DB.prepare("DELETE FROM pending_admin_deletions WHERE id = ?").bind(row.id).run();
    finalized += 1;
  }
  return finalized;
}
