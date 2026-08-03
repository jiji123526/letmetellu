import { Env } from "../types";
import { getParentChannelId, getReportsChannelId } from "./special-channels";

export type ModerationStatus = "active" | "warned" | "suspended" | "frozen";
export type PetitionStatus = "none" | "open" | "accepted" | "rejected";
export type UserLocale = "ko" | "en";

export interface ChannelModerationRow {
  channel_id: string;
  status: ModerationStatus;
  warning_sent_at: string | null;
  warned_report_count: number;
  suspension_notice_sent_at: string | null;
  suspension_reason: string | null;
  frozen_at: string | null;
  frozen_by: string | null;
  petition_status: PetitionStatus;
  current_petition_id: string | null;
  updated_at: string | null;
}

export interface ChannelPetitionRow {
  id: string;
  channel_id: string;
  owner_uid: string;
  text: string;
  status: "open" | "accepted" | "rejected";
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  inbox_message_id: string | null;
}

const DEFAULT_MODERATION_STATUS: ChannelModerationRow = {
  channel_id: "",
  status: "active",
  warning_sent_at: null,
  warned_report_count: 0,
  suspension_notice_sent_at: null,
  suspension_reason: null,
  frozen_at: null,
  frozen_by: null,
  petition_status: "none",
  current_petition_id: null,
  updated_at: null,
};

export function normalizeUserLocale(value: string | null | undefined): UserLocale {
  return value === "en" ? "en" : "ko";
}

export async function getUserLocale(userId: string, env: Env): Promise<UserLocale> {
  if (!userId) return "ko";
  const result = await env.DB.prepare("SELECT locale FROM users WHERE id = ?")
    .bind(userId)
    .first<{ locale: string | null }>();
  return normalizeUserLocale(result?.locale);
}

export async function getChannelModeration(channelId: string, env: Env): Promise<ChannelModerationRow> {
  const parentChannelId = getParentChannelId(channelId);
  const moderation = await env.DB.prepare(`
    SELECT
      channel_id,
      status,
      warning_sent_at,
      warned_report_count,
      suspension_notice_sent_at,
      suspension_reason,
      frozen_at,
      frozen_by,
      petition_status,
      current_petition_id,
      updated_at
    FROM channel_moderation
    WHERE channel_id = ?
    LIMIT 1
  `).bind(parentChannelId).first<ChannelModerationRow>();

  return moderation
    ? { ...DEFAULT_MODERATION_STATUS, ...moderation, channel_id: parentChannelId }
    : { ...DEFAULT_MODERATION_STATUS, channel_id: parentChannelId };
}

export async function setChannelModeration(
  channelId: string,
  patch: Partial<ChannelModerationRow>,
  env: Env,
): Promise<ChannelModerationRow> {
  const parentChannelId = getParentChannelId(channelId);
  const current = await getChannelModeration(parentChannelId, env);
  const next: ChannelModerationRow = {
    ...current,
    ...patch,
    channel_id: parentChannelId,
    updated_at: new Date().toISOString(),
  };

  await env.DB.prepare(`
    INSERT INTO channel_moderation (
      channel_id,
      status,
      warning_sent_at,
      warned_report_count,
      suspension_notice_sent_at,
      suspension_reason,
      frozen_at,
      frozen_by,
      petition_status,
      current_petition_id,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      status = excluded.status,
      warning_sent_at = excluded.warning_sent_at,
      warned_report_count = excluded.warned_report_count,
      suspension_notice_sent_at = excluded.suspension_notice_sent_at,
      suspension_reason = excluded.suspension_reason,
      frozen_at = excluded.frozen_at,
      frozen_by = excluded.frozen_by,
      petition_status = excluded.petition_status,
      current_petition_id = excluded.current_petition_id,
      updated_at = excluded.updated_at
  `).bind(
    next.channel_id,
    next.status,
    next.warning_sent_at,
    next.warned_report_count,
    next.suspension_notice_sent_at,
    next.suspension_reason,
    next.frozen_at,
    next.frozen_by,
    next.petition_status,
    next.current_petition_id,
    next.updated_at,
  ).run();

  return next;
}

export function isOwnerModerationBlocked(moderation: Pick<ChannelModerationRow, "status"> | null | undefined): boolean {
  return moderation?.status === "frozen";
}

export async function countOpenChannelReports(channelId: string, env: Env): Promise<number> {
  const parentChannelId = getParentChannelId(channelId);
  const result = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM channel_reports
    WHERE channel_id = ? AND status = 'open'
  `).bind(parentChannelId).first<{ count: number }>();
  return Number(result?.count || 0);
}

export async function getOpenChannelPetition(channelId: string, env: Env): Promise<ChannelPetitionRow | null> {
  const parentChannelId = getParentChannelId(channelId);
  return env.DB.prepare(`
    SELECT
      id,
      channel_id,
      owner_uid,
      text,
      status,
      created_at,
      resolved_at,
      resolved_by,
      resolution_note,
      inbox_message_id
    FROM channel_petitions
    WHERE channel_id = ? AND status = 'open'
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(parentChannelId).first<ChannelPetitionRow>();
}

export async function broadcastFreezeChange(channelId: string, frozen: boolean, env: Env): Promise<void> {
  const parentChannelId = getParentChannelId(channelId);
  const doId = env.CHAT_ROOM.idFromName(parentChannelId);
  const stub = env.CHAT_ROOM.get(doId);
  await stub.fetch(new Request("http://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({ type: "freeze-change", frozen, live: false, moderation: true }),
  }));
}

export async function broadcastModerationStateChange(
  channelId: string,
  status: ModerationStatus,
  env: Env,
): Promise<void> {
  const parentChannelId = getParentChannelId(channelId);
  const doId = env.CHAT_ROOM.idFromName(parentChannelId);
  const stub = env.CHAT_ROOM.get(doId);
  await stub.fetch(new Request("http://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({ type: "moderation-state-change", status, live: false }),
  }));
}

export async function sendOwnerModerationNotice(input: {
  channelId: string;
  ownerUid: string;
  text: string;
  env: Env;
  nick?: string;
}): Promise<{ id: string; created_at: string }> {
  const channelId = getParentChannelId(input.channelId);
  const createdAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const reportsChannelId = getReportsChannelId(input.env);
  const platformAdmin = reportsChannelId
    ? await input.env.DB.prepare(`
      SELECT channels.owner_uid AS uid, users.name AS name
      FROM channels
      LEFT JOIN users ON users.id = channels.owner_uid
      WHERE channels.id = ?
      LIMIT 1
    `).bind(reportsChannelId).first<{ uid: string; name: string | null }>()
    : null;
  const senderUid = platformAdmin?.uid || "system-moderation";
  const senderAuthUid = platformAdmin?.uid || null;
  const nick = input.nick || platformAdmin?.name?.trim() || "운영팀";
  const protectedSender = Boolean(platformAdmin?.uid) || senderUid === "system-moderation";

  await input.env.DB.prepare(`
    INSERT INTO dm (id, uid, auth_uid, nick, text, image, channel_id, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
  `).bind(
    id,
    senderUid,
    senderAuthUid,
    nick,
    input.text,
    channelId,
    createdAt,
  ).run();

  const doId = input.env.CHAT_ROOM.idFromName(channelId);
  const stub = input.env.CHAT_ROOM.get(doId);
  await stub.fetch(new Request("http://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({
      type: "dm-new",
      dm: {
        id,
        uid: senderUid,
        auth_uid: senderAuthUid,
        nick,
        text: input.text,
        image: null,
        channel_id: channelId,
        created_at: createdAt,
        protected_sender: protectedSender,
      },
    }),
  }));

  return { id, created_at: createdAt };
}

export async function getReportsChannelOwner(env: Env): Promise<{ id: string; owner_uid: string } | null> {
  const reportsChannelId = getReportsChannelId(env);
  if (!reportsChannelId) return null;
  return env.DB.prepare("SELECT id, owner_uid FROM channels WHERE id = ?")
    .bind(reportsChannelId)
    .first<{ id: string; owner_uid: string }>();
}

export async function postReportsInboxMessage(input: {
  env: Env;
  text: string;
  nick?: string;
  extra?: Record<string, unknown>;
  id?: string;
  createdAt?: string;
}): Promise<{ id: string; created_at: string }> {
  const reportsChannel = await getReportsChannelOwner(input.env);
  if (!reportsChannel) {
    throw new Error("reports_channel_not_found");
  }

  const id = input.id || crypto.randomUUID();
  const createdAt = input.createdAt || new Date().toISOString();
  const nick = input.nick || "신고함";

  await input.env.DB.prepare(`
    INSERT INTO messages (
      id, uid, auth_uid, nick, text, is_admin, channel_id, image, reply_to, report, reported_msg_id, gallery_id, created_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, NULL, NULL, 0, NULL, NULL, ?)
  `).bind(
    id,
    reportsChannel.owner_uid,
    reportsChannel.owner_uid,
    nick,
    input.text,
    reportsChannel.id,
    createdAt,
  ).run();

  const doId = input.env.CHAT_ROOM.idFromName(reportsChannel.id);
  const stub = input.env.CHAT_ROOM.get(doId);
  await stub.fetch(new Request("http://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({
      type: "message-new",
      message: {
        id,
        uid: reportsChannel.owner_uid,
        auth_uid: reportsChannel.owner_uid,
        nick,
        text: input.text,
        is_admin: 1,
        channel_id: reportsChannel.id,
        image: null,
        reply_to: null,
        report: 0,
        reported_msg_id: null,
        gallery_id: null,
        created_at: createdAt,
        ...(input.extra || {}),
      },
    }),
  }));

  return { id, created_at: createdAt };
}

export async function editReportsInboxMessage(input: {
  env: Env;
  messageId: string;
  text: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  await input.env.DB.prepare("UPDATE messages SET text = ?, edited = 1 WHERE id = ?")
    .bind(input.text, input.messageId)
    .run();

  const reportsChannel = await getReportsChannelOwner(input.env);
  if (!reportsChannel) return;

  const doId = input.env.CHAT_ROOM.idFromName(reportsChannel.id);
  const stub = input.env.CHAT_ROOM.get(doId);
  await stub.fetch(new Request("http://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({
      type: "message-edited",
      message_id: input.messageId,
      text: input.text,
      edited: true,
      ...(input.extra || {}),
    }),
  }));
}
