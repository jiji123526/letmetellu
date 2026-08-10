import { verifyAnonymousIdentityToken, verifyDeviceIdentityToken } from "../lib/anonymous-identity";
import {
  broadcastModerationStateChange,
  broadcastFreezeChange,
  countOpenChannelReports,
  editReportsInboxMessage,
  getChannelModeration,
  getOpenChannelPetition,
  getReportsChannelOwner,
  getUserLocale,
  isOwnerModerationBlocked,
  postReportsInboxMessage,
  sendOwnerModerationNotice,
  setChannelModeration,
  type UserLocale,
} from "../lib/channel-moderation";
import { consumeDurableRateLimit } from "../lib/durable-rate-limit";
import { getTrustedUserId } from "../lib/trusted-identity";
import { appendModerationAuditLog } from "../lib/moderation-audit";
import { getParentChannelId, isReportsChannel, isReportsChannelOwner } from "../lib/special-channels";
import { Env } from "../types";
import { deleteChannel } from "./admin";
import { authorizeRoomToken } from "./passcode";

const REPORT_REASONS = new Set([
  "spam",
  "harassment",
  "sexual_content",
  "privacy",
  "impersonation",
  "illegal_content",
  "other",
]);

const REPORT_REASON_LABELS: Record<UserLocale, Record<string, string>> = {
  ko: {
    spam: "스팸",
    harassment: "괴롭힘 또는 혐오",
    sexual_content: "성적 콘텐츠",
    privacy: "개인정보 노출",
    impersonation: "사칭 또는 사기",
    illegal_content: "불법 또는 위험 콘텐츠",
    other: "기타",
  },
  en: {
    spam: "Spam",
    harassment: "Harassment or hate",
    sexual_content: "Sexual content",
    privacy: "Privacy exposure",
    impersonation: "Impersonation or fraud",
    illegal_content: "Illegal or dangerous content",
    other: "Other",
  },
};

const MAX_DETAILS_LENGTH = 500;
const REPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const REPORT_DAILY_LIMIT = 3;
const REPORT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPORT_STATUSES = new Set(["open", "resolved", "dismissed"]);
const PETITION_STATUSES = new Set(["open", "accepted", "rejected"]);
const MODERATION_STATUSES = new Set(["active", "warned", "suspended", "frozen"]);

function buildReporterQuotaSubjectKey(input: {
  isVerifiedUser: boolean;
  verifiedUserId: string;
  anonymousUid: string;
  requesterDeviceId: string | null;
}): string {
  if (input.isVerifiedUser) {
    return `auth:${input.verifiedUserId}`;
  }
  return `anon:${input.anonymousUid}:${input.requesterDeviceId || "unknown"}`;
}

export interface ReportMeta {
  report_id: string;
  channel_id: string;
  channel_name: string;
  channel_url: string;
  reason: string;
  reason_label: string;
  status: "open" | "resolved" | "dismissed";
  details: string | null;
  reporter_label: string;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  moderation_status: "active" | "warned" | "suspended" | "frozen";
  petition_status: "none" | "open" | "accepted" | "rejected";
}

export interface PetitionMeta {
  petition_id: string;
  channel_id: string;
  channel_name: string;
  channel_url: string;
  owner_label: string;
  text: string;
  status: "open" | "accepted" | "rejected";
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
}

interface ChannelReportRow {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_owner_uid: string;
  reporter_uid: string;
  reporter_auth_uid: string | null;
  reporter_device_id: string | null;
  reason: string;
  details: string | null;
  created_at: string;
  status: "open" | "resolved" | "dismissed";
  resolution_note: string | null;
  resolved_at: string | null;
  inbox_message_id: string | null;
  moderation_status: string | null;
  petition_status: string | null;
}

interface ChannelPetitionInboxRow {
  id: string;
  channel_id: string;
  channel_name: string;
  owner_uid: string;
  owner_name: string | null;
  text: string;
  status: "open" | "accepted" | "rejected";
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  inbox_message_id: string | null;
}

async function getAnonymousRequesterUid(request: Request, env: Env): Promise<string | null> {
  const token = request.headers.get("X-Anonymous-Token");
  if (!token) return null;
  const payload = await verifyAnonymousIdentityToken(token, env);
  return payload?.uid || null;
}

async function getRequesterDeviceId(request: Request, env: Env): Promise<string | null> {
  const token = request.headers.get("X-Device-Token");
  if (!token) return null;
  const payload = await verifyDeviceIdentityToken(token, env);
  return payload?.device_id || null;
}

function reportReasonLabel(reason: string, locale: UserLocale): string {
  return REPORT_REASON_LABELS[locale][reason] || reason;
}

function formatReporterLabel(input: { authUid: string | null; uid: string; deviceId: string | null }, locale: UserLocale): string {
  if (input.authUid) {
    return locale === "en"
      ? `Account #${input.authUid.slice(-6)}`
      : `계정 #${input.authUid.slice(-6)}`;
  }
  const deviceSuffix = input.deviceId
    ? locale === "en"
      ? ` / Device#${input.deviceId.slice(-6)}`
      : ` / 기기#${input.deviceId.slice(-6)}`
    : "";
  return locale === "en"
    ? `Anon #${input.uid.slice(-6)}${deviceSuffix}`
    : `익명 #${input.uid.slice(-6)}${deviceSuffix}`;
}

function formatOwnerLabel(ownerUid: string, ownerName: string | null, locale: UserLocale): string {
  if (ownerName?.trim()) return locale === "en" ? `${ownerName.trim()} Admin` : `${ownerName.trim()} 관리자`;
  return locale === "en"
    ? `Channel Admin #${ownerUid.slice(-6)}`
    : `채널 관리자 #${ownerUid.slice(-6)}`;
}

function channelReportUrl(channelId: string, env: Env): string {
  return `${env.APP_ORIGIN.replace(/\/$/, "")}/ch/${encodeURIComponent(channelId)}`;
}

function reportStatusLabel(status: "open" | "resolved" | "dismissed", locale: UserLocale): string {
  if (locale === "en") {
    if (status === "resolved") return "Resolved";
    if (status === "dismissed") return "Dismissed";
    return "Open";
  }
  if (status === "resolved") return "해결됨";
  if (status === "dismissed") return "기각됨";
  return "접수됨";
}

function moderationStatusLabel(status: "active" | "warned" | "suspended" | "frozen", locale: UserLocale): string {
  if (locale === "en") {
    if (status === "warned") return "Warning sent";
    if (status === "suspended") return "Suspension notice sent";
    if (status === "frozen") return "Frozen";
    return "Active";
  }
  if (status === "warned") return "경고 발송";
  if (status === "suspended") return "정지 안내 발송";
  if (status === "frozen") return "동결됨";
  return "정상";
}

function petitionStatusLabel(status: "none" | "open" | "accepted" | "rejected", locale: UserLocale): string {
  if (locale === "en") {
    if (status === "open") return "Open";
    if (status === "accepted") return "Accepted";
    if (status === "rejected") return "Rejected";
    return "None";
  }
  if (status === "open") return "접수됨";
  if (status === "accepted") return "승인됨";
  if (status === "rejected") return "기각됨";
  return "없음";
}

function buildReportMeta(row: ChannelReportRow, env: Env, locale: UserLocale = "ko"): ReportMeta {
  return {
    report_id: row.id,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    channel_url: channelReportUrl(row.channel_id, env),
    reason: row.reason,
    reason_label: reportReasonLabel(row.reason, locale),
    status: REPORT_STATUSES.has(row.status) ? row.status : "open",
    details: row.details || null,
    reporter_label: formatReporterLabel({
      authUid: row.reporter_auth_uid,
      uid: row.reporter_uid,
      deviceId: row.reporter_device_id,
    }, locale),
    created_at: row.created_at,
    resolved_at: row.resolved_at || null,
    resolution_note: row.resolution_note || null,
    moderation_status: MODERATION_STATUSES.has(row.moderation_status || "") ? row.moderation_status as ReportMeta["moderation_status"] : "active",
    petition_status: (["none", ...PETITION_STATUSES] as string[]).includes(row.petition_status || "")
      ? (row.petition_status as ReportMeta["petition_status"] || "none")
      : "none",
  };
}

function buildPetitionMeta(row: ChannelPetitionInboxRow, env: Env, locale: UserLocale = "ko"): PetitionMeta {
  return {
    petition_id: row.id,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    channel_url: channelReportUrl(row.channel_id, env),
    owner_label: formatOwnerLabel(row.owner_uid, row.owner_name, locale),
    text: row.text,
    status: PETITION_STATUSES.has(row.status) ? row.status : "open",
    created_at: row.created_at,
    resolved_at: row.resolved_at || null,
    resolution_note: row.resolution_note || null,
  };
}

function formatReportMessageFromMeta(meta: ReportMeta, locale: UserLocale): string {
  const lines = locale === "en"
    ? [
        "🚨 Channel report",
        `Report ID: ${meta.report_id}`,
        `Channel: ${meta.channel_name} (${meta.channel_url})`,
        `Reason: ${meta.reason_label}`,
        `Reporter: ${meta.reporter_label}`,
        `Submitted at: ${meta.created_at}`,
        `Details: ${meta.details || "-"}`,
        `Report status: ${reportStatusLabel(meta.status, locale)}`,
        `Moderation status: ${moderationStatusLabel(meta.moderation_status, locale)}`,
      ]
    : [
        "🚨 채널 신고",
        `신고 ID: ${meta.report_id}`,
        `채널: ${meta.channel_name} (${meta.channel_url})`,
        `사유: ${meta.reason_label}`,
        `신고자: ${meta.reporter_label}`,
        `접수 시각: ${meta.created_at}`,
        `상세 내용: ${meta.details || "-"}`,
        `신고 상태: ${reportStatusLabel(meta.status, locale)}`,
        `제재 상태: ${moderationStatusLabel(meta.moderation_status, locale)}`,
      ];

  if (meta.petition_status !== "none") {
    lines.push(locale === "en"
      ? `Appeal: ${petitionStatusLabel(meta.petition_status, locale)}`
      : `이의 제기: ${petitionStatusLabel(meta.petition_status, locale)}`);
  }
  if (meta.resolved_at) {
    lines.push(locale === "en" ? `Handled at: ${meta.resolved_at}` : `처리 시각: ${meta.resolved_at}`);
  }
  if (meta.resolution_note) {
    lines.push(locale === "en" ? `Resolution note: ${meta.resolution_note}` : `처리 메모: ${meta.resolution_note}`);
  }
  return lines.join("\n");
}

function formatPetitionMessageFromMeta(meta: PetitionMeta, locale: UserLocale): string {
  const lines = locale === "en"
    ? [
        "📝 Channel appeal",
        `Appeal ID: ${meta.petition_id}`,
        `Channel: ${meta.channel_name} (${meta.channel_url})`,
        `Submitted by: ${meta.owner_label}`,
        `Submitted at: ${meta.created_at}`,
        `Details: ${meta.text}`,
        `Status: ${petitionStatusLabel(meta.status, locale)}`,
      ]
    : [
        "📝 채널 이의 제기",
        `이의 제기 ID: ${meta.petition_id}`,
        `채널: ${meta.channel_name} (${meta.channel_url})`,
        `제출자: ${meta.owner_label}`,
        `접수 시각: ${meta.created_at}`,
        `내용: ${meta.text}`,
        `상태: ${petitionStatusLabel(meta.status, locale)}`,
      ];

  if (meta.resolved_at) {
    lines.push(locale === "en" ? `Handled at: ${meta.resolved_at}` : `처리 시각: ${meta.resolved_at}`);
  }
  if (meta.resolution_note) {
    lines.push(locale === "en" ? `Resolution note: ${meta.resolution_note}` : `처리 메모: ${meta.resolution_note}`);
  }
  return lines.join("\n");
}

async function fetchChannelReportById(reportId: string, env: Env): Promise<ChannelReportRow | null> {
  return env.DB.prepare(`
    SELECT
      cr.id,
      cr.channel_id,
      ch.name AS channel_name,
      ch.owner_uid AS channel_owner_uid,
      cr.reporter_uid,
      cr.reporter_auth_uid,
      cr.reporter_device_id,
      cr.reason,
      cr.details,
      cr.created_at,
      cr.status,
      cr.resolution_note,
      cr.resolved_at,
      cr.inbox_message_id,
      cm.status AS moderation_status,
      cm.petition_status
    FROM channel_reports cr
    INNER JOIN channels ch ON ch.id = cr.channel_id
    LEFT JOIN channel_moderation cm ON cm.channel_id = cr.channel_id
    WHERE cr.id = ?
    LIMIT 1
  `).bind(reportId).first<ChannelReportRow>();
}

async function fetchChannelPetitionById(petitionId: string, env: Env): Promise<ChannelPetitionInboxRow | null> {
  return env.DB.prepare(`
    SELECT
      cp.id,
      cp.channel_id,
      ch.name AS channel_name,
      cp.owner_uid,
      u.name AS owner_name,
      cp.text,
      cp.status,
      cp.created_at,
      cp.resolved_at,
      cp.resolved_by,
      cp.resolution_note,
      cp.inbox_message_id
    FROM channel_petitions cp
    INNER JOIN channels ch ON ch.id = cp.channel_id
    LEFT JOIN users u ON u.id = cp.owner_uid
    WHERE cp.id = ?
    LIMIT 1
  `).bind(petitionId).first<ChannelPetitionInboxRow>();
}

export async function hydrateReportInboxMessages<T extends { id: string }>(
  messages: T[],
  env: Env,
  locale: UserLocale = "ko",
): Promise<Array<T & { report_meta?: ReportMeta; petition_meta?: PetitionMeta }>> {
  if (messages.length === 0) return messages as Array<T & { report_meta?: ReportMeta; petition_meta?: PetitionMeta }>;
  const ids = messages.map((message) => message.id).filter(Boolean);
  if (ids.length === 0) return messages as Array<T & { report_meta?: ReportMeta; petition_meta?: PetitionMeta }>;

  const placeholders = ids.map(() => "?").join(", ");
  const [reportRows, petitionRows] = await Promise.all([
    env.DB.prepare(`
      SELECT
        cr.id,
        cr.channel_id,
        ch.name AS channel_name,
        ch.owner_uid AS channel_owner_uid,
        cr.reporter_uid,
        cr.reporter_auth_uid,
        cr.reporter_device_id,
        cr.reason,
        cr.details,
        cr.created_at,
        cr.status,
        cr.resolution_note,
        cr.resolved_at,
        cr.inbox_message_id,
        cm.status AS moderation_status,
        cm.petition_status
      FROM channel_reports cr
      INNER JOIN channels ch ON ch.id = cr.channel_id
      LEFT JOIN channel_moderation cm ON cm.channel_id = cr.channel_id
      WHERE cr.inbox_message_id IN (${placeholders})
    `).bind(...ids).all<ChannelReportRow>(),
    env.DB.prepare(`
      SELECT
        cp.id,
        cp.channel_id,
        ch.name AS channel_name,
        cp.owner_uid,
        u.name AS owner_name,
        cp.text,
        cp.status,
        cp.created_at,
        cp.resolved_at,
        cp.resolved_by,
        cp.resolution_note,
        cp.inbox_message_id
      FROM channel_petitions cp
      INNER JOIN channels ch ON ch.id = cp.channel_id
      LEFT JOIN users u ON u.id = cp.owner_uid
      WHERE cp.inbox_message_id IN (${placeholders})
    `).bind(...ids).all<ChannelPetitionInboxRow>(),
  ]);

  const reportByMessageId = new Map<string, ReportMeta>();
  for (const row of reportRows.results || []) {
    if (!row.inbox_message_id) continue;
    reportByMessageId.set(row.inbox_message_id, buildReportMeta(row, env, locale));
  }

  const petitionByMessageId = new Map<string, PetitionMeta>();
  for (const row of petitionRows.results || []) {
    if (!row.inbox_message_id) continue;
    petitionByMessageId.set(row.inbox_message_id, buildPetitionMeta(row, env, locale));
  }

  return messages.map((message) => {
    const reportMeta = reportByMessageId.get(message.id);
    const petitionMeta = petitionByMessageId.get(message.id);
    return reportMeta || petitionMeta
      ? { ...message, ...(reportMeta ? { report_meta: reportMeta } : {}), ...(petitionMeta ? { petition_meta: petitionMeta } : {}) }
      : message;
  });
}

async function requireReportsChannelOwner(request: Request, env: Env): Promise<string | null> {
  const userId = getTrustedUserId(request, env) || "";
  if (!userId) return null;
  return await isReportsChannelOwner(userId, env) ? userId : null;
}

async function syncReportInboxMessage(
  reportId: string,
  env: Env,
  locale: UserLocale,
): Promise<{ report: ReportMeta; message_text: string } | null> {
  const updated = await fetchChannelReportById(reportId, env);
  if (!updated) return null;
  const reportMeta = buildReportMeta(updated, env, locale);
  const reportText = formatReportMessageFromMeta(reportMeta, locale);
  if (updated.inbox_message_id) {
    await editReportsInboxMessage({
      env,
      messageId: updated.inbox_message_id,
      text: reportText,
      extra: { report_meta: reportMeta },
    });
  }
  return { report: reportMeta, message_text: reportText };
}

async function syncChannelReportInboxMessages(
  channelId: string,
  env: Env,
  locale: UserLocale,
): Promise<void> {
  const parentChannelId = getParentChannelId(channelId);
  const rows = await env.DB.prepare(`
    SELECT
      cr.id,
      cr.channel_id,
      ch.name AS channel_name,
      ch.owner_uid AS channel_owner_uid,
      cr.reporter_uid,
      cr.reporter_auth_uid,
      cr.reporter_device_id,
      cr.reason,
      cr.details,
      cr.created_at,
      cr.status,
      cr.resolution_note,
      cr.resolved_at,
      cr.inbox_message_id,
      cm.status AS moderation_status,
      cm.petition_status
    FROM channel_reports cr
    INNER JOIN channels ch ON ch.id = cr.channel_id
    LEFT JOIN channel_moderation cm ON cm.channel_id = cr.channel_id
    WHERE cr.channel_id = ? AND cr.inbox_message_id IS NOT NULL
  `).bind(parentChannelId).all<ChannelReportRow>();

  for (const row of rows.results || []) {
    if (!row.inbox_message_id) continue;
    const reportMeta = buildReportMeta(row, env, locale);
    await editReportsInboxMessage({
      env,
      messageId: row.inbox_message_id,
      text: formatReportMessageFromMeta(reportMeta, locale),
      extra: { report_meta: reportMeta },
    });
  }
}

async function maybeSendAutomaticOwnerWarning(input: {
  env: Env;
  channelId: string;
  channelName: string;
  ownerUid: string;
}): Promise<void> {
  const reportCount = await countOpenChannelReports(input.channelId, input.env);
  if (reportCount <= 5) return;

  const moderation = await getChannelModeration(input.channelId, input.env);
  if (moderation.warned_report_count > 5) return;

  const now = new Date().toISOString();
  const ownerLocale = await getUserLocale(input.ownerUid, input.env);
  await sendOwnerModerationNotice({
    env: input.env,
    channelId: input.channelId,
    ownerUid: input.ownerUid,
    text: ownerLocale === "en"
      ? [
          "[Moderation notice]",
          `${input.channelName} has received more than 5 open reports.`,
          "Please review the channel rules again. Repeated issues may lead to freezing or deletion.",
        ].join("\n")
      : [
          "[운영 알림]",
          `${input.channelName} 채널에 신고가 6건 이상 누적되었습니다.`,
          "운영 기준을 다시 확인해 주세요. 반복될 경우 채널 동결 또는 삭제가 진행될 수 있습니다.",
        ].join("\n"),
  });
  await setChannelModeration(input.channelId, {
    status: moderation.status === "active" ? "warned" : moderation.status,
    warning_sent_at: now,
    warned_report_count: reportCount,
  }, input.env);
}

async function handleReportResolutionAction(input: {
  reportId: string;
  action: "resolve" | "dismiss";
  resolutionNote: string;
  actorUserId: string;
  actorLocale: UserLocale;
  env: Env;
}): Promise<Response> {
  const existing = await fetchChannelReportById(input.reportId, input.env);
  if (!existing) {
    return Response.json({ error: "report_not_found" }, { status: 404 });
  }
  if (existing.status !== "open") {
    return Response.json({ error: "report_already_processed" }, { status: 409 });
  }

  const resolvedAt = new Date().toISOString();
  const nextStatus = input.action === "resolve" ? "resolved" : "dismissed";
  await input.env.DB.prepare(`
    UPDATE channel_reports
    SET status = ?, resolution_note = ?, resolved_at = ?
    WHERE id = ? AND status = 'open'
  `).bind(nextStatus, input.resolutionNote || null, resolvedAt, input.reportId).run();

  await appendModerationAuditLog({
    env: input.env,
    actorUserId: input.actorUserId,
    action: input.action === "resolve" ? "report_resolved" : "report_dismissed",
    targetType: "channel_report",
    targetId: existing.id,
    reason: input.resolutionNote || null,
    before: {
      status: existing.status,
      resolution_note: existing.resolution_note,
      resolved_at: existing.resolved_at,
    },
    after: {
      status: nextStatus,
      resolution_note: input.resolutionNote || null,
      resolved_at: resolvedAt,
    },
  });

  const synced = await syncReportInboxMessage(input.reportId, input.env, input.actorLocale);
  if (!synced) {
    return Response.json({ error: "report_not_found" }, { status: 404 });
  }

  return Response.json({
    ok: true,
    report: synced.report,
    message_text: synced.message_text,
    acted_by: input.actorUserId,
  });
}

async function handleModerationAction(input: {
  reportId: string;
  action: "warn_owner" | "send_suspend_notice" | "freeze_channel" | "unfreeze_channel" | "delete_channel";
  resolutionNote: string;
  actorUserId: string;
  actorLocale: UserLocale;
  env: Env;
}): Promise<Response> {
  const existing = await fetchChannelReportById(input.reportId, input.env);
  if (!existing) {
    return Response.json({ error: "report_not_found" }, { status: 404 });
  }

  const moderation = await getChannelModeration(existing.channel_id, input.env);
  const moderationBefore = { ...moderation };
  const ownerLocale = await getUserLocale(existing.channel_owner_uid, input.env);

  if (input.action === "warn_owner") {
    if (existing.status !== "open") {
      return Response.json({ error: "report_already_processed" }, { status: 409 });
    }
    const warnedAt = new Date().toISOString();
    const nextStatus = moderation.status === "active" ? "warned" : moderation.status;
    const warnedReportCount = Math.max(moderation.warned_report_count, await countOpenChannelReports(existing.channel_id, input.env));
    await sendOwnerModerationNotice({
      env: input.env,
      channelId: existing.channel_id,
      ownerUid: existing.channel_owner_uid,
      text: ownerLocale === "en"
        ? [
            "[Moderation warning]",
            `${existing.channel_name} is under moderation review due to reports.`,
            `Latest reason: ${reportReasonLabel(existing.reason, ownerLocale)}`,
            input.resolutionNote ? `Note: ${input.resolutionNote}` : "Please review the moderation rules again.",
          ].join("\n")
        : [
            "[운영 경고]",
            `${existing.channel_name} 채널이 신고로 검토 중입니다.`,
            `최근 신고 사유: ${reportReasonLabel(existing.reason, ownerLocale)}`,
            input.resolutionNote ? `메모: ${input.resolutionNote}` : "운영 기준을 다시 확인해 주세요.",
          ].join("\n"),
    });
    await setChannelModeration(existing.channel_id, {
      status: nextStatus,
      warning_sent_at: warnedAt,
      warned_report_count: warnedReportCount,
    }, input.env);
    await broadcastModerationStateChange(
      existing.channel_id,
      nextStatus,
      input.env,
    );
    await appendModerationAuditLog({
      env: input.env,
      actorUserId: input.actorUserId,
      action: "warn_owner",
      targetType: "channel",
      targetId: existing.channel_id,
      reason: input.resolutionNote || null,
      before: moderationBefore,
      after: {
        ...moderationBefore,
        status: nextStatus,
        warning_sent_at: warnedAt,
        warned_report_count: warnedReportCount,
      },
    });
  }

  if (input.action === "send_suspend_notice") {
    const suspensionSentAt = new Date().toISOString();
    const nextStatus = isOwnerModerationBlocked(moderation) ? moderation.status : "suspended";
    const suspensionReason = input.resolutionNote || reportReasonLabel(existing.reason, ownerLocale);
    await sendOwnerModerationNotice({
      env: input.env,
      channelId: existing.channel_id,
      ownerUid: existing.channel_owner_uid,
      text: ownerLocale === "en"
        ? [
            "[Suspension notice]",
            `${existing.channel_name} has moved into the suspension review stage.`,
            `Reason: ${reportReasonLabel(existing.reason, ownerLocale)}`,
            input.resolutionNote ? `Note: ${input.resolutionNote}` : "Further violations may lead to the channel being frozen.",
          ].join("\n")
        : [
            "[운영 정지 안내]",
            `${existing.channel_name} 채널이 정지 검토 단계에 들어갔습니다.`,
            `사유: ${reportReasonLabel(existing.reason, ownerLocale)}`,
            input.resolutionNote ? `메모: ${input.resolutionNote}` : "추가 위반이 확인되면 채널이 동결될 수 있습니다.",
          ].join("\n"),
    });
    await setChannelModeration(existing.channel_id, {
      status: nextStatus,
      suspension_notice_sent_at: suspensionSentAt,
      suspension_reason: suspensionReason,
    }, input.env);
    await broadcastModerationStateChange(
      existing.channel_id,
      nextStatus,
      input.env,
    );
    await appendModerationAuditLog({
      env: input.env,
      actorUserId: input.actorUserId,
      action: "send_suspend_notice",
      targetType: "channel",
      targetId: existing.channel_id,
      reason: input.resolutionNote || null,
      before: moderationBefore,
      after: {
        ...moderationBefore,
        status: nextStatus,
        suspension_notice_sent_at: suspensionSentAt,
        suspension_reason: suspensionReason,
      },
    });
  }

  if (input.action === "freeze_channel") {
    if (moderation.status === "frozen") {
      return Response.json({ error: "channel_already_frozen" }, { status: 409 });
    }
    const frozenAt = new Date().toISOString();
    await input.env.DB.prepare("UPDATE channels SET is_frozen = 1 WHERE id = ?")
      .bind(existing.channel_id)
      .run();
    await setChannelModeration(existing.channel_id, {
      status: "frozen",
      suspension_notice_sent_at: frozenAt,
      frozen_at: frozenAt,
      frozen_by: input.actorUserId,
      petition_status: "none",
      current_petition_id: null,
      suspension_reason: input.resolutionNote || moderation.suspension_reason,
    }, input.env);
    await sendOwnerModerationNotice({
      env: input.env,
      channelId: existing.channel_id,
      ownerUid: existing.channel_owner_uid,
      text: ownerLocale === "en"
        ? [
            "[Channel suspended and frozen]",
            `${existing.channel_name} was suspended and frozen for moderation review.`,
            "While frozen, the channel owner cannot send messages.",
            "If you want to contest this before deletion, submit an appeal.",
          ].join("\n")
        : [
            "[채널 정지 및 동결]",
            `${existing.channel_name} 채널이 운영 검토를 위해 정지 및 동결되었습니다.`,
            "동결 중에는 채널 관리자가 메시지를 보낼 수 없습니다.",
            "삭제 전에 이의가 있으면 이의 제기를 제출해 주세요.",
          ].join("\n"),
    });
    await broadcastFreezeChange(existing.channel_id, true, input.env);
    await broadcastModerationStateChange(existing.channel_id, "frozen", input.env);
    await appendModerationAuditLog({
      env: input.env,
      actorUserId: input.actorUserId,
      action: "freeze_channel",
      targetType: "channel",
      targetId: existing.channel_id,
      reason: input.resolutionNote || null,
      before: moderationBefore,
      after: {
        ...moderationBefore,
        status: "frozen",
        suspension_notice_sent_at: frozenAt,
        frozen_at: frozenAt,
        frozen_by: input.actorUserId,
        petition_status: "none",
        current_petition_id: null,
        suspension_reason: input.resolutionNote || moderation.suspension_reason,
      },
    });
  }

  if (input.action === "unfreeze_channel") {
    if (moderation.status !== "frozen") {
      return Response.json({ error: "channel_not_frozen" }, { status: 409 });
    }
    await input.env.DB.prepare("UPDATE channels SET is_frozen = 0 WHERE id = ?")
      .bind(existing.channel_id)
      .run();
    await setChannelModeration(existing.channel_id, {
      status: "active",
      suspension_notice_sent_at: null,
      suspension_reason: null,
      frozen_at: null,
      frozen_by: null,
    }, input.env);
    await sendOwnerModerationNotice({
      env: input.env,
      channelId: existing.channel_id,
      ownerUid: existing.channel_owner_uid,
      text: ownerLocale === "en"
        ? [
            "[Channel unfrozen]",
            `${existing.channel_name} has been unfrozen after super admin review.`,
            "Please continue to follow the moderation rules.",
          ].join("\n")
        : [
            "[채널 동결 해제]",
            `${existing.channel_name} 채널의 동결이 슈퍼 관리자 검토 후 해제되었습니다.`,
            "운영 기준을 계속 준수해 주세요.",
          ].join("\n"),
    });
    await broadcastFreezeChange(existing.channel_id, false, input.env);
    await broadcastModerationStateChange(existing.channel_id, "active", input.env);
    await appendModerationAuditLog({
      env: input.env,
      actorUserId: input.actorUserId,
      action: "unfreeze_channel",
      targetType: "channel",
      targetId: existing.channel_id,
      reason: input.resolutionNote || null,
      before: moderationBefore,
      after: {
        ...moderationBefore,
        status: "active",
        suspension_notice_sent_at: null,
        suspension_reason: null,
        frozen_at: null,
        frozen_by: null,
      },
    });
  }

  if (input.action === "delete_channel") {
    if (moderation.status !== "frozen") {
      return Response.json({ error: "freeze_required_before_delete" }, { status: 409 });
    }
    const openPetition = await getOpenChannelPetition(existing.channel_id, input.env);
    if (openPetition) {
      return Response.json({ error: "petition_pending" }, { status: 409 });
    }

    const deletedText = [
      formatReportMessageFromMeta(buildReportMeta(existing, input.env, input.actorLocale), input.actorLocale),
      input.actorLocale === "en" ? "Action result: Channel deleted" : "조치 결과: 채널 삭제 완료",
      input.actorLocale === "en" ? `Handled at: ${new Date().toISOString()}` : `처리 시각: ${new Date().toISOString()}`,
    ].join("\n");
    if (existing.inbox_message_id) {
      await editReportsInboxMessage({
        env: input.env,
        messageId: existing.inbox_message_id,
        text: deletedText,
      });
    }
    await appendModerationAuditLog({
      env: input.env,
      actorUserId: input.actorUserId,
      action: "delete_channel",
      targetType: "channel",
      targetId: existing.channel_id,
      reason: input.resolutionNote || null,
      before: moderationBefore,
      after: {
        deleted: true,
        report_status: existing.status,
      },
    });
    await deleteChannel(existing.channel_id, input.env);
    return Response.json({
      ok: true,
      report_id: existing.id,
      message_text: deletedText,
      deleted_channel_id: existing.channel_id,
      acted_by: input.actorUserId,
    });
  }

  if (input.action === "warn_owner" || input.action === "send_suspend_notice" || input.action === "freeze_channel" || input.action === "unfreeze_channel") {
    await syncChannelReportInboxMessages(existing.channel_id, input.env, input.actorLocale);
  }

  const synced = await syncReportInboxMessage(existing.id, input.env, input.actorLocale);
  if (!synced) {
    return Response.json({ error: "report_not_found" }, { status: 404 });
  }

  return Response.json({
    ok: true,
    report: synced.report,
    message_text: synced.message_text,
    acted_by: input.actorUserId,
  });
}

async function handleChannelPetitionAction(input: {
  petitionId: string;
  action: "accept_petition" | "reject_petition" | "unfreeze_channel";
  resolutionNote: string;
  actorUserId: string;
  actorLocale: UserLocale;
  env: Env;
}): Promise<Response> {
  const petition = await fetchChannelPetitionById(input.petitionId, input.env);
  if (!petition) {
    return Response.json({ error: "petition_not_found" }, { status: 404 });
  }
  const ownerLocale = await getUserLocale(petition.owner_uid, input.env);
  const moderationBefore = await getChannelModeration(petition.channel_id, input.env);
  if (input.action === "unfreeze_channel") {
    if (moderationBefore.status !== "frozen") {
      return Response.json({ error: "channel_not_frozen" }, { status: 409 });
    }

    await input.env.DB.prepare("UPDATE channels SET is_frozen = 0 WHERE id = ?")
      .bind(petition.channel_id)
      .run();
    await setChannelModeration(petition.channel_id, {
      status: "active",
      suspension_notice_sent_at: null,
      suspension_reason: null,
      frozen_at: null,
      frozen_by: null,
      petition_status: petition.status,
      current_petition_id: petition.id,
    }, input.env);
    await sendOwnerModerationNotice({
      env: input.env,
      channelId: petition.channel_id,
      ownerUid: petition.owner_uid,
      text: ownerLocale === "en"
        ? [
            "[Channel unfrozen]",
            `${petition.channel_name} has been unfrozen after super admin review.`,
            "Please continue to follow the moderation rules.",
          ].join("\n")
        : [
            "[채널 동결 해제]",
            `${petition.channel_name} 채널의 동결이 슈퍼 관리자 검토 후 해제되었습니다.`,
            "운영 기준을 계속 준수해 주세요.",
          ].join("\n"),
    });
    await broadcastFreezeChange(petition.channel_id, false, input.env);
    await broadcastModerationStateChange(petition.channel_id, "active", input.env);
    await syncChannelReportInboxMessages(petition.channel_id, input.env, input.actorLocale);
    await appendModerationAuditLog({
      env: input.env,
      actorUserId: input.actorUserId,
      action: "unfreeze_channel",
      targetType: "channel",
      targetId: petition.channel_id,
      reason: input.resolutionNote || null,
      before: {
        petition: {
          id: petition.id,
          status: petition.status,
          resolved_at: petition.resolved_at,
          resolution_note: petition.resolution_note,
        },
        moderation: moderationBefore,
      },
      after: {
        petition: {
          id: petition.id,
          status: petition.status,
          resolved_at: petition.resolved_at,
          resolution_note: petition.resolution_note,
        },
        moderation: {
          ...moderationBefore,
          status: "active",
          suspension_notice_sent_at: null,
          suspension_reason: null,
          frozen_at: null,
          frozen_by: null,
          petition_status: petition.status,
          current_petition_id: petition.id,
        },
      },
    });

    const updated = await fetchChannelPetitionById(petition.id, input.env);
    if (!updated) {
      return Response.json({ error: "petition_not_found" }, { status: 404 });
    }
    const petitionMeta = buildPetitionMeta(updated, input.env, input.actorLocale);
    const petitionText = formatPetitionMessageFromMeta(petitionMeta, input.actorLocale);
    if (updated.inbox_message_id) {
      await editReportsInboxMessage({
        env: input.env,
        messageId: updated.inbox_message_id,
        text: petitionText,
        extra: { petition_meta: petitionMeta },
      });
    }

    return Response.json({
      ok: true,
      petition: petitionMeta,
      message_text: petitionText,
      acted_by: input.actorUserId,
    });
  }

  if (petition.status !== "open") {
    return Response.json({ error: "petition_already_processed" }, { status: 409 });
  }

  const resolvedAt = new Date().toISOString();
  const nextStatus = input.action === "accept_petition" ? "accepted" : "rejected";
  await input.env.DB.prepare(`
    UPDATE channel_petitions
    SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?
    WHERE id = ? AND status = 'open'
  `).bind(nextStatus, resolvedAt, input.actorUserId, input.resolutionNote || null, petition.id).run();

  if (nextStatus === "accepted") {
    await input.env.DB.prepare("UPDATE channels SET is_frozen = 0 WHERE id = ?")
      .bind(petition.channel_id)
      .run();
    await setChannelModeration(petition.channel_id, {
      status: "active",
      suspension_notice_sent_at: null,
      suspension_reason: null,
      frozen_at: null,
      frozen_by: null,
      petition_status: "accepted",
      current_petition_id: petition.id,
    }, input.env);
    await sendOwnerModerationNotice({
      env: input.env,
      channelId: petition.channel_id,
      ownerUid: petition.owner_uid,
      text: ownerLocale === "en"
        ? [
            "[Appeal accepted]",
            `${petition.channel_name} has been unfrozen.`,
            input.resolutionNote ? `Note: ${input.resolutionNote}` : "Please continue to follow the moderation rules.",
          ].join("\n")
        : [
            "[이의 제기 승인]",
            `${petition.channel_name} 채널의 동결이 해제되었습니다.`,
            input.resolutionNote ? `메모: ${input.resolutionNote}` : "운영 기준을 준수해 주세요.",
          ].join("\n"),
    });
    await broadcastFreezeChange(petition.channel_id, false, input.env);
    await broadcastModerationStateChange(petition.channel_id, "active", input.env);
  } else {
    await setChannelModeration(petition.channel_id, {
      status: "frozen",
      petition_status: "rejected",
      current_petition_id: petition.id,
    }, input.env);
    await sendOwnerModerationNotice({
      env: input.env,
      channelId: petition.channel_id,
      ownerUid: petition.owner_uid,
      text: ownerLocale === "en"
        ? [
            "[Appeal rejected]",
            `${petition.channel_name}'s appeal was rejected.`,
            input.resolutionNote ? `Note: ${input.resolutionNote}` : "The channel will remain frozen until further review.",
          ].join("\n")
        : [
            "[이의 제기 기각]",
            `${petition.channel_name} 채널의 이의 제기가 기각되었습니다.`,
            input.resolutionNote ? `메모: ${input.resolutionNote}` : "추가 검토 전까지 동결 상태가 유지됩니다.",
          ].join("\n"),
    });
    await broadcastModerationStateChange(petition.channel_id, "frozen", input.env);
  }

  await appendModerationAuditLog({
    env: input.env,
    actorUserId: input.actorUserId,
    action: nextStatus === "accepted" ? "accept_petition" : "reject_petition",
    targetType: "channel_petition",
    targetId: petition.id,
    reason: input.resolutionNote || null,
    before: {
      petition: {
        status: petition.status,
        resolved_at: petition.resolved_at,
        resolved_by: petition.resolved_by,
        resolution_note: petition.resolution_note,
      },
      moderation: moderationBefore,
    },
    after: {
      petition: {
        status: nextStatus,
        resolved_at: resolvedAt,
        resolved_by: input.actorUserId,
        resolution_note: input.resolutionNote || null,
      },
      moderation: nextStatus === "accepted"
        ? {
            ...moderationBefore,
            status: "active",
            suspension_notice_sent_at: null,
            suspension_reason: null,
            frozen_at: null,
            frozen_by: null,
            petition_status: "accepted",
            current_petition_id: petition.id,
          }
        : {
            ...moderationBefore,
            status: "frozen",
            petition_status: "rejected",
            current_petition_id: petition.id,
          },
    },
  });

  await syncChannelReportInboxMessages(petition.channel_id, input.env, input.actorLocale);

  const updated = await fetchChannelPetitionById(petition.id, input.env);
  if (!updated) {
    return Response.json({ error: "petition_not_found" }, { status: 404 });
  }
  const petitionMeta = buildPetitionMeta(updated, input.env, input.actorLocale);
  const petitionText = formatPetitionMessageFromMeta(petitionMeta, input.actorLocale);
  if (updated.inbox_message_id) {
    await editReportsInboxMessage({
      env: input.env,
      messageId: updated.inbox_message_id,
      text: petitionText,
      extra: { petition_meta: petitionMeta },
    });
  }

  return Response.json({
    ok: true,
    petition: petitionMeta,
    message_text: petitionText,
    acted_by: input.actorUserId,
  });
}

async function handleChannelReportAction(request: Request, env: Env): Promise<Response> {
  const actorUserId = await requireReportsChannelOwner(request, env);
  if (!actorUserId) {
    return Response.json({ error: "owner access required" }, { status: 403 });
  }
  const actorLocale = await getUserLocale(actorUserId, env);

  const body = await request.json() as Record<string, unknown>;
  const reportId = typeof body.report_id === "string" ? body.report_id : "";
  const petitionId = typeof body.petition_id === "string" ? body.petition_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  const resolutionNote = typeof body.resolution_note === "string" ? body.resolution_note.trim().slice(0, MAX_DETAILS_LENGTH) : "";

  if (petitionId) {
    if (action !== "accept_petition" && action !== "reject_petition" && action !== "unfreeze_channel") {
      return Response.json({ error: "invalid_action" }, { status: 400 });
    }
    return handleChannelPetitionAction({
      petitionId,
      action,
      resolutionNote,
      actorUserId,
      actorLocale,
      env,
    });
  }

  if (!reportId) {
    return Response.json({ error: "invalid_action" }, { status: 400 });
  }

  if (action === "resolve" || action === "dismiss") {
    return handleReportResolutionAction({
      reportId,
      action,
      resolutionNote,
      actorUserId,
      actorLocale,
      env,
    });
  }

  if (
    action === "warn_owner"
    || action === "send_suspend_notice"
    || action === "freeze_channel"
    || action === "unfreeze_channel"
    || action === "delete_channel"
  ) {
    return handleModerationAction({
      reportId,
      action,
      resolutionNote,
      actorUserId,
      actorLocale,
      env,
    });
  }

  return Response.json({ error: "invalid_action" }, { status: 400 });
}

function formatReportMessage(input: {
  reportId: string;
  channelId: string;
  channelName: string;
  reason: string;
  details: string;
  reporterLabel: string;
  createdAt: string;
  locale: UserLocale;
  moderationStatus?: ReportMeta["moderation_status"];
  petitionStatus?: ReportMeta["petition_status"];
  resolutionNote?: string | null;
  status?: "open" | "resolved" | "dismissed";
  resolvedAt?: string | null;
}, env: Env): string {
  return formatReportMessageFromMeta({
    report_id: input.reportId,
    channel_id: input.channelId,
    channel_name: input.channelName,
    channel_url: channelReportUrl(input.channelId, env),
    reason: input.reason,
    reason_label: reportReasonLabel(input.reason, input.locale),
    status: input.status || "open",
    details: input.details || null,
    reporter_label: input.reporterLabel,
    created_at: input.createdAt,
    resolved_at: input.resolvedAt || null,
    resolution_note: input.resolutionNote || null,
    moderation_status: input.moderationStatus || "active",
    petition_status: input.petitionStatus || "none",
  }, input.locale);
}

export async function handleChannelReports(request: Request, env: Env): Promise<Response> {
  if (request.method === "PATCH") {
    return handleChannelReportAction(request, env);
  }

  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const body = await request.json() as Record<string, unknown>;
  const rawChannelId = typeof body.channel_id === "string" ? body.channel_id : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const details = typeof body.details === "string" ? body.details.trim() : "";

  if (!rawChannelId || !reason || !REPORT_REASONS.has(reason)) {
    return Response.json({ error: "invalid_report" }, { status: 400 });
  }
  if (details.length > MAX_DETAILS_LENGTH) {
    return Response.json({ error: "report_details_too_long" }, { status: 400 });
  }

  const channelId = getParentChannelId(rawChannelId);
  if (isReportsChannel(channelId, env)) {
    return Response.json({ error: "cannot_report_reports_channel" }, { status: 403 });
  }

  const sourceChannel = await env.DB.prepare(
    "SELECT id, name, owner_uid, passcode FROM channels WHERE id = ?"
  ).bind(channelId).first<{ id: string; name: string; owner_uid: string; passcode: string | null }>();
  if (!sourceChannel) {
    return Response.json({ error: "channel not found" }, { status: 404 });
  }

  const verifiedUserId = getTrustedUserId(request, env) || "";
  const isVerifiedUser = Boolean(verifiedUserId);
  const isChannelOwner = isVerifiedUser && verifiedUserId === sourceChannel.owner_uid;
  if (isChannelOwner) {
    return Response.json({ error: "channel_owner_cannot_report" }, { status: 403 });
  }

  if (sourceChannel.passcode) {
    const roomToken = request.headers.get("X-Room-Token");
    if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
    const decoded = await authorizeRoomToken(roomToken, channelId, sourceChannel.passcode, env);
    if (!decoded) {
      return Response.json({ error: "invalid token" }, { status: 403 });
    }
  }

  const anonymousUid = isVerifiedUser ? verifiedUserId : await getAnonymousRequesterUid(request, env);
  const requesterDeviceId = isVerifiedUser ? await getRequesterDeviceId(request, env) : await getRequesterDeviceId(request, env);
  if (!anonymousUid) {
    return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
  }
  if (!isVerifiedUser && !requesterDeviceId) {
    return Response.json({ error: "anonymous_identity_required" }, { status: 401 });
  }

  const cooldownCutoff = new Date(Date.now() - REPORT_COOLDOWN_MS).toISOString();
  const duplicate = isVerifiedUser
    ? await env.DB.prepare(
        `SELECT id FROM channel_reports
         WHERE channel_id = ?
           AND reporter_auth_uid = ?
           AND created_at >= ?
         LIMIT 1`
      ).bind(channelId, verifiedUserId, cooldownCutoff).first<{ id: string }>()
    : await env.DB.prepare(
        `SELECT id FROM channel_reports
         WHERE channel_id = ?
           AND reporter_uid = ?
           AND reporter_device_id = ?
           AND created_at >= ?
         LIMIT 1`
      ).bind(channelId, anonymousUid, requesterDeviceId || "", cooldownCutoff).first<{ id: string }>();
  if (duplicate) {
    return Response.json({ error: "report_exists" }, { status: 409 });
  }

  const dailyReportQuota = await consumeDurableRateLimit({
    env,
    scope: "channel-report-day",
    subjectKey: buildReporterQuotaSubjectKey({
      isVerifiedUser,
      verifiedUserId,
      anonymousUid,
      requesterDeviceId,
    }),
    limit: REPORT_DAILY_LIMIT,
    windowMs: REPORT_DAILY_WINDOW_MS,
  });
  if (!dailyReportQuota.ok) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const reportId = crypto.randomUUID();
  const reportMessageId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO channel_reports (
      id, channel_id, reporter_uid, reporter_auth_uid, reporter_device_id, reason, details, created_at, status, inbox_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
  `).bind(
    reportId,
    channelId,
    anonymousUid,
    isVerifiedUser ? verifiedUserId : null,
    requesterDeviceId || null,
    reason,
    details || null,
    createdAt,
    reportMessageId,
  ).run();

  await maybeSendAutomaticOwnerWarning({
    env,
    channelId,
    channelName: sourceChannel.name,
    ownerUid: sourceChannel.owner_uid,
  });

  const reportRow = await fetchChannelReportById(reportId, env);
  if (!reportRow) {
    return Response.json({ error: "report_not_found" }, { status: 404 });
  }

  const reportsChannelOwner = await getReportsChannelOwner(env);
  const reportsOwnerLocale = reportsChannelOwner
    ? await getUserLocale(reportsChannelOwner.owner_uid, env)
    : "ko";
  const reportMeta = buildReportMeta(reportRow, env, reportsOwnerLocale);
  const reportText = formatReportMessage({
    reportId,
    channelId,
    channelName: sourceChannel.name,
    reason,
    details,
    reporterLabel: formatReporterLabel({
      authUid: isVerifiedUser ? verifiedUserId : null,
      uid: anonymousUid,
      deviceId: requesterDeviceId,
    }, reportsOwnerLocale),
    createdAt,
    locale: reportsOwnerLocale,
    moderationStatus: reportMeta.moderation_status,
    petitionStatus: reportMeta.petition_status,
  }, env);

  await postReportsInboxMessage({
    env,
    id: reportMessageId,
    createdAt,
    text: reportText,
    nick: reportsOwnerLocale === "en" ? "Reports" : "신고함",
    extra: { report_meta: reportMeta },
  });

  return Response.json({ ok: true, id: reportId, created_at: createdAt, report: reportMeta });
}
