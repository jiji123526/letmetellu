import type { Env } from "../types.ts";

interface DmRootRow {
  id: string;
  client_message_id: string | null;
  uid: string;
  auth_uid: string | null;
  nick: string | null;
  text: string;
  image: string | null;
  image_w: number | null;
  image_h: number | null;
  channel_id: string;
  created_at: string;
}

interface DmReplyRow {
  id: string;
  client_reply_id: string;
  dm_id: string;
  channel_id: string;
  owner_uid: string;
  text: string;
  image: string | null;
  image_w: number | null;
  image_h: number | null;
  created_at: string;
}

export interface PrivateDmMessage {
  id: string;
  client_message_id: string | null;
  uid: string;
  auth_uid: string | null;
  nick: string | null;
  text: string;
  is_admin: number;
  image: string | null;
  image_w: number | null;
  image_h: number | null;
  reactions: string;
  reply_to: string | null;
  channel_id: string;
  created_at: string;
  dm: true;
  dm_reply?: true;
}

export async function readDmThreads(
  env: Env,
  channelId: string,
  viewer: { owner: true } | { owner: false; anonymousUid: string },
): Promise<PrivateDmMessage[]> {
  const rootSelectColumns = "id, client_message_id, uid, auth_uid, nick, text, image, image_w, image_h, channel_id, created_at";
  const rootQuery = viewer.owner
    ? `SELECT ${rootSelectColumns} FROM (SELECT ${rootSelectColumns} FROM dm WHERE channel_id = ? AND pending_delete_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 50) ORDER BY created_at ASC, id ASC`
    : `SELECT ${rootSelectColumns} FROM (SELECT ${rootSelectColumns} FROM dm WHERE channel_id = ? AND uid = ? AND pending_delete_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 50) ORDER BY created_at ASC, id ASC`;
  const rootStatement = viewer.owner
    ? env.DB.prepare(rootQuery).bind(channelId)
    : env.DB.prepare(rootQuery).bind(channelId, viewer.anonymousUid);
  const roots = (await rootStatement.all<DmRootRow>()).results || [];
  if (roots.length === 0) return [];

  const placeholders = roots.map(() => "?").join(", ");
  const replies = (await env.DB.prepare(`
    SELECT id, client_reply_id, dm_id, channel_id, owner_uid, text, image, image_w, image_h, created_at
    FROM dm_replies
    WHERE dm_id IN (${placeholders})
      AND pending_delete_at IS NULL
    ORDER BY created_at ASC, id ASC
  `).bind(...roots.map((root) => root.id)).all<DmReplyRow>()).results || [];

  const messages: PrivateDmMessage[] = roots.map((root) => ({
    id: root.id,
    client_message_id: root.client_message_id,
    uid: root.uid,
    auth_uid: root.auth_uid,
    nick: root.nick,
    text: root.text || "",
    is_admin: 0,
    image: root.image,
    image_w: root.image_w,
    image_h: root.image_h,
    reactions: "{}",
    reply_to: null,
    channel_id: root.channel_id,
    created_at: root.created_at,
    dm: true,
  }));
  messages.push(...replies.map((reply) => ({
    id: reply.id,
    client_message_id: reply.client_reply_id,
    uid: reply.owner_uid,
    auth_uid: reply.owner_uid,
    nick: null,
    text: reply.text,
    is_admin: 1,
    image: reply.image,
    image_w: reply.image_w,
    image_h: reply.image_h,
    reactions: "{}",
    reply_to: reply.dm_id,
    channel_id: reply.channel_id,
    created_at: reply.created_at,
    dm: true as const,
    dm_reply: true as const,
  })));

  return messages.sort((left, right) =>
    left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
  );
}
