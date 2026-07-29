import { verifyAnonymousIdentityToken, verifyDeviceIdentityToken } from "../lib/anonymous-identity";
import { getParentChannelId, getReportsChannelId, isReportsChannel, isReportsChannelOwner } from "../lib/special-channels";
import { Env } from "../types";
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

const REPORT_REASON_LABELS: Record<string, string> = {
  spam: "스팸",
  harassment: "괴롭힘 또는 혐오",
  sexual_content: "성적 콘텐츠",
  privacy: "개인정보 노출",
  impersonation: "사칭 또는 사기",
  illegal_content: "불법 또는 위험 콘텐츠",
  other: "기타",
};

const MAX_DETAILS_LENGTH = 500;
const REPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const REPORT_STATUSES = new Set(["open", "resolved", "dismissed"]);

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
}

interface ChannelReportRow {
  id: string;
  channel_id: string;
  channel_name: string;
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

function formatReporterLabel(input: { authUid: string | null; uid: string; deviceId: string | null }): string {
  if (input.authUid) {
    return `계정 #${input.authUid.slice(-6)}`;
  }
  const deviceSuffix = input.deviceId ? ` / 기기#${input.deviceId.slice(-6)}` : "";
  return `익명 #${input.uid.slice(-6)}${deviceSuffix}`;
}

function channelReportUrl(channelId: string, env: Env): string {
  return `${env.APP_ORIGIN.replace(/\/$/, "")}/ch/${encodeURIComponent(channelId)}`;
}

function reportStatusLabel(status: "open" | "resolved" | "dismissed"): string {
  if (status === "resolved") return "해결됨";
  if (status === "dismissed") return "기각됨";
  return "접수됨";
}

function buildReportMeta(row: ChannelReportRow, env: Env): ReportMeta {
  return {
    report_id: row.id,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    channel_url: channelReportUrl(row.channel_id, env),
    reason: row.reason,
    reason_label: REPORT_REASON_LABELS[row.reason] || row.reason,
    status: REPORT_STATUSES.has(row.status) ? row.status : "open",
    details: row.details || null,
    reporter_label: formatReporterLabel({
      authUid: row.reporter_auth_uid,
      uid: row.reporter_uid,
      deviceId: row.reporter_device_id,
    }),
    created_at: row.created_at,
    resolved_at: row.resolved_at || null,
    resolution_note: row.resolution_note || null,
  };
}

function formatReportMessageFromMeta(meta: ReportMeta): string {
  const lines = [
    "🚨 채널 신고",
    `신고 ID: ${meta.report_id}`,
    `채널: ${meta.channel_name} (/ch/${meta.channel_id})`,
    `사유: ${meta.reason_label}`,
    `신고자: ${meta.reporter_label}`,
    `접수 시각: ${meta.created_at}`,
    `상세 내용: ${meta.details || "-"}`,
    `상태: ${reportStatusLabel(meta.status)}`,
  ];

  if (meta.resolved_at) {
    lines.push(`처리 시각: ${meta.resolved_at}`);
  }
  if (meta.resolution_note) {
    lines.push(`처리 메모: ${meta.resolution_note}`);
  }
  return lines.join("\n");
}

async function fetchChannelReportById(reportId: string, env: Env): Promise<ChannelReportRow | null> {
  return env.DB.prepare(`
    SELECT
      cr.id,
      cr.channel_id,
      ch.name AS channel_name,
      cr.reporter_uid,
      cr.reporter_auth_uid,
      cr.reporter_device_id,
      cr.reason,
      cr.details,
      cr.created_at,
      cr.status,
      cr.resolution_note,
      cr.resolved_at,
      cr.inbox_message_id
    FROM channel_reports cr
    INNER JOIN channels ch ON ch.id = cr.channel_id
    WHERE cr.id = ?
    LIMIT 1
  `).bind(reportId).first<ChannelReportRow>();
}

export async function hydrateReportInboxMessages<T extends { id: string }>(
  messages: T[],
  env: Env,
): Promise<Array<T & { report_meta?: ReportMeta }>> {
  if (messages.length === 0) return messages as Array<T & { report_meta?: ReportMeta }>;
  const ids = messages.map((message) => message.id).filter(Boolean);
  if (ids.length === 0) return messages as Array<T & { report_meta?: ReportMeta }>;

  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(`
    SELECT
      cr.id,
      cr.channel_id,
      ch.name AS channel_name,
      cr.reporter_uid,
      cr.reporter_auth_uid,
      cr.reporter_device_id,
      cr.reason,
      cr.details,
      cr.created_at,
      cr.status,
      cr.resolution_note,
      cr.resolved_at,
      cr.inbox_message_id
    FROM channel_reports cr
    INNER JOIN channels ch ON ch.id = cr.channel_id
    WHERE cr.inbox_message_id IN (${placeholders})
  `).bind(...ids).all<ChannelReportRow>();

  const reportByMessageId = new Map<string, ReportMeta>();
  for (const row of results || []) {
    if (!row.inbox_message_id) continue;
    reportByMessageId.set(row.inbox_message_id, buildReportMeta(row, env));
  }

  return messages.map((message) => {
    const reportMeta = reportByMessageId.get(message.id);
    return reportMeta ? { ...message, report_meta: reportMeta } : message;
  });
}

async function requireReportsChannelOwner(request: Request, env: Env): Promise<string | null> {
  if (request.headers.get("X-Internal-Token") !== env.INTERNAL_SECRET) return null;
  const userId = request.headers.get("X-User-Id") || "";
  if (!userId) return null;
  return await isReportsChannelOwner(userId, env) ? userId : null;
}

async function handleChannelReportAction(request: Request, env: Env): Promise<Response> {
  const actorUserId = await requireReportsChannelOwner(request, env);
  if (!actorUserId) {
    return Response.json({ error: "owner access required" }, { status: 403 });
  }

  const body = await request.json() as Record<string, unknown>;
  const reportId = typeof body.report_id === "string" ? body.report_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  const resolutionNote = typeof body.resolution_note === "string" ? body.resolution_note.trim().slice(0, MAX_DETAILS_LENGTH) : "";
  const nextStatus = action === "resolve" ? "resolved" : action === "dismiss" ? "dismissed" : null;
  if (!reportId || !nextStatus) {
    return Response.json({ error: "invalid_action" }, { status: 400 });
  }

  const existing = await fetchChannelReportById(reportId, env);
  if (!existing) {
    return Response.json({ error: "report_not_found" }, { status: 404 });
  }
  if (existing.status !== "open") {
    return Response.json({ error: "report_already_processed" }, { status: 409 });
  }

  const resolvedAt = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE channel_reports
    SET status = ?, resolution_note = ?, resolved_at = ?
    WHERE id = ? AND status = 'open'
  `).bind(nextStatus, resolutionNote || null, resolvedAt, reportId).run();

  const updated = await fetchChannelReportById(reportId, env);
  if (!updated) {
    return Response.json({ error: "report_not_found" }, { status: 404 });
  }
  const reportMeta = buildReportMeta(updated, env);
  const reportText = formatReportMessageFromMeta(reportMeta);

  if (updated.inbox_message_id) {
    await env.DB.prepare("UPDATE messages SET text = ?, edited = 1 WHERE id = ?")
      .bind(reportText, updated.inbox_message_id)
      .run();

    const reportsChannelId = getReportsChannelId(env);
    if (reportsChannelId) {
      const doId = env.CHAT_ROOM.idFromName(reportsChannelId);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({
          type: "message-edited",
          message_id: updated.inbox_message_id,
          text: reportText,
          edited: true,
          report_meta: reportMeta,
        }),
      }));
    }
  }

  return Response.json({
    ok: true,
    report: reportMeta,
    message_text: reportText,
    acted_by: actorUserId,
  });
}

function formatReportMessage(input: {
  reportId: string;
  channelId: string;
  channelName: string;
  reason: string;
  details: string;
  reporterLabel: string;
  createdAt: string;
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
    reason_label: REPORT_REASON_LABELS[input.reason] || input.reason,
    status: input.status || "open",
    details: input.details || null,
    reporter_label: input.reporterLabel,
    created_at: input.createdAt,
    resolved_at: input.resolvedAt || null,
    resolution_note: input.resolutionNote || null,
  });
}

export async function handleChannelReports(request: Request, env: Env): Promise<Response> {
  if (request.method === "PATCH") {
    return handleChannelReportAction(request, env);
  }

  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const reportsChannelId = getReportsChannelId(env);
  if (!reportsChannelId) {
    return Response.json({ error: "reports_channel_not_configured" }, { status: 503 });
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

  const internalToken = request.headers.get("X-Internal-Token");
  const verifiedUserId = request.headers.get("X-User-Id") || "";
  const isVerifiedUser = internalToken === env.INTERNAL_SECRET && !!verifiedUserId;
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

  const reportsChannel = await env.DB.prepare(
    "SELECT id, owner_uid FROM channels WHERE id = ?"
  ).bind(reportsChannelId).first<{ id: string; owner_uid: string }>();
  if (!reportsChannel) {
    return Response.json({ error: "reports_channel_not_found" }, { status: 503 });
  }

  const reportId = crypto.randomUUID();
  const reportMessageId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const reporterLabel = formatReporterLabel({
    authUid: isVerifiedUser ? verifiedUserId : null,
    uid: anonymousUid,
    deviceId: requesterDeviceId,
  });
  const reportText = formatReportMessage({
    reportId,
    channelId,
    channelName: sourceChannel.name,
    reason,
    details,
    reporterLabel,
    createdAt,
  }, env);
  const reportMeta = buildReportMeta({
    id: reportId,
    channel_id: channelId,
    channel_name: sourceChannel.name,
    reporter_uid: anonymousUid,
    reporter_auth_uid: isVerifiedUser ? verifiedUserId : null,
    reporter_device_id: requesterDeviceId || null,
    reason,
    details: details || null,
    created_at: createdAt,
    status: "open",
    resolution_note: null,
    resolved_at: null,
    inbox_message_id: reportMessageId,
  }, env);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO channel_reports (
        id, channel_id, reporter_uid, reporter_auth_uid, reporter_device_id, reason, details, created_at, status, inbox_message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`
    ).bind(
      reportId,
      channelId,
      anonymousUid,
      isVerifiedUser ? verifiedUserId : null,
      requesterDeviceId || null,
      reason,
      details || null,
      createdAt,
      reportMessageId,
    ),
    env.DB.prepare(
      `INSERT INTO messages (
        id, uid, auth_uid, nick, text, is_admin, channel_id, image, reply_to, fingerprint, report, reported_msg_id, gallery_id, created_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, NULL, NULL, NULL, 0, NULL, NULL, ?)`
    ).bind(
      reportMessageId,
      reportsChannel.owner_uid,
      reportsChannel.owner_uid,
      "신고함",
      reportText,
      reportsChannel.id,
      createdAt,
    ),
  ]);

  const doId = env.CHAT_ROOM.idFromName(reportsChannel.id);
  const stub = env.CHAT_ROOM.get(doId);
  const inboxMessage = {
    id: reportMessageId,
    uid: reportsChannel.owner_uid,
    auth_uid: reportsChannel.owner_uid,
    nick: "신고함",
    text: reportText,
    is_admin: 1,
    channel_id: reportsChannel.id,
    image: null,
    reply_to: null,
    fingerprint: null,
    report: 0,
    reported_msg_id: null,
    gallery_id: null,
    created_at: createdAt,
    report_meta: reportMeta,
  };
  await stub.fetch(new Request("http://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({ type: "message-new", message: inboxMessage }),
  }));

  return Response.json({ ok: true, id: reportId, created_at: createdAt });
}
