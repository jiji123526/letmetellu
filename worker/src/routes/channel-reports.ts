import { verifyAnonymousIdentityToken, verifyDeviceIdentityToken } from "../lib/anonymous-identity";
import { getParentChannelId, getReportsChannelId, isReportsChannel } from "../lib/special-channels";
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
  spam: "Spam",
  harassment: "Harassment or hate",
  sexual_content: "Sexual content",
  privacy: "Privacy exposure",
  impersonation: "Impersonation or fraud",
  illegal_content: "Illegal or dangerous content",
  other: "Other",
};

const MAX_DETAILS_LENGTH = 500;
const REPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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
    return `Account #${input.authUid.slice(-6)}`;
  }
  const deviceSuffix = input.deviceId ? ` / device#${input.deviceId.slice(-6)}` : "";
  return `Anon #${input.uid.slice(-6)}${deviceSuffix}`;
}

function formatReportMessage(input: {
  reportId: string;
  channelId: string;
  channelName: string;
  reason: string;
  details: string;
  reporterLabel: string;
  createdAt: string;
}): string {
  return [
    "🚨 Channel report",
    `Report ID: ${input.reportId}`,
    `Channel: ${input.channelName} (/ch/${input.channelId})`,
    `Reason: ${REPORT_REASON_LABELS[input.reason] || input.reason}`,
    `Reporter: ${input.reporterLabel}`,
    `Submitted: ${input.createdAt}`,
    `Details: ${input.details || "-"}`,
  ].join("\n");
}

export async function handleChannelReports(request: Request, env: Env): Promise<Response> {
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
  });

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO channel_reports (
        id, channel_id, reporter_uid, reporter_auth_uid, reporter_device_id, reason, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      reportId,
      channelId,
      anonymousUid,
      isVerifiedUser ? verifiedUserId : null,
      requesterDeviceId || null,
      reason,
      details || null,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO messages (
        id, uid, auth_uid, nick, text, is_admin, channel_id, image, reply_to, fingerprint, report, reported_msg_id, gallery_id, created_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, NULL, NULL, NULL, 0, NULL, NULL, ?)`
    ).bind(
      reportMessageId,
      reportsChannel.owner_uid,
      reportsChannel.owner_uid,
      "Report inbox",
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
    nick: "Report inbox",
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
  };
  await stub.fetch(new Request("http://internal/broadcast", {
    method: "POST",
    body: JSON.stringify({ type: "message-new", message: inboxMessage }),
  }));

  return Response.json({ ok: true, id: reportId, created_at: createdAt });
}
