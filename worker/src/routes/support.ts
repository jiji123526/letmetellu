import type { Env } from "../types.ts";
import { createAnonymousIdentity, createDeviceIdentity, verifyAnonymousIdentityToken, verifyDeviceIdentityToken } from "../lib/anonymous-identity.ts";
import { getUserLocale, type UserLocale } from "../lib/channel-moderation.ts";
import { recordOperationalEvent } from "../lib/operational-events.ts";
import {
  serializeAuthMonitoringSummary,
  type AuthMonitoringRow,
} from "../lib/auth-monitoring.ts";
import {
  deriveOperationalHealthStatus,
  OPERATIONAL_HEALTH_THRESHOLDS,
  serializeOperationalHealthWindow,
  type OperationalHealthWindowRow,
} from "../lib/operational-health.ts";
import { isOperationalAlertingEnabled } from "../lib/operational-alerts.ts";
import { getTrustedUserId } from "../lib/trusted-identity.ts";
import { getReportsChannelId, isReportsChannelOwner } from "../lib/special-channels.ts";
import { buildSupportFlow, buildSupportSummary, getSupportNode, supportTopicLabel, type SupportNode, type SupportTranscriptEvent } from "../lib/support-flow.ts";
import { appendSupportAuditLog } from "../lib/support-audit.ts";
import { consumeDurableRateLimit } from "../lib/durable-rate-limit.ts";

const SUPPORT_TEXT_MAX_LENGTH = 1_500;
const SUPPORT_SESSION_TEXT_MAX_LENGTH = 500;
const SUPPORT_RATE_LIMIT_WINDOW_MS = 30_000;
const SUPPORT_START_LIMIT = 3;
const SUPPORT_ANSWER_LIMIT = 12;
const SUPPORT_MESSAGE_LIMIT = 8;
const ANONYMOUS_SUPPORT_PREFIX = "anon:";
const SUPPORT_STALE_MS = 24 * 60 * 60 * 1000;
const SUPPORT_CRITICAL_STALE_MS = 72 * 60 * 60 * 1000;
const SUPPORT_DASHBOARD_CLOSED_TICKET_LIMIT = 30;
const SUPPORT_DASHBOARD_OPEN_TICKET_LIMIT = 40;
const SUPPORT_DASHBOARD_OPEN_TICKET_MAX_LIMIT = 100;

type SupportSessionStatus = "open" | "resolved" | "escalated" | "abandoned";
type SupportThreadStatus = "open" | "closed";

interface SupportSessionRow {
  id: string;
  user_id: string;
  status: SupportSessionStatus;
  entry_topic: string | null;
  current_node_id: string;
  resolved_via_tree: number;
  escalated_thread_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface SupportThreadRow {
  id: string;
  user_id: string;
  source_session_id: string | null;
  entry_topic: string | null;
  summary: string;
  status: SupportThreadStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
  user_acknowledged_at: string | null;
  user_name?: string | null;
  user_email?: string | null;
  last_message?: string | null;
  last_sender_role?: "user" | "platform_admin" | null;
  has_admin_reply?: number;
  last_user_message_at?: string | null;
  last_admin_message_at?: string | null;
  user_read_at?: string | null;
  admin_read_at?: string | null;
}

interface SupportMessageRow {
  id: string;
  thread_id: string;
  sender_role: "user" | "platform_admin";
  sender_user_id: string | null;
  text: string;
  created_at: string;
}

interface ReportsChannelRow {
  id: string;
  name: string;
  profile_image: string | null;
  bubble_color: string | null;
  created_at: string;
}

interface PlatformDashboardVersionRow {
  total_count: number;
  active_count: number;
  latest_at: string | null;
}

interface PlatformDashboardTicketRow extends SupportThreadRow {
  has_admin_reply?: number;
}

interface PlatformDashboardStatsRow {
  open_count: number;
  waiting_for_admin_count: number;
  waiting_for_user_count: number;
  unread_for_admin_count: number;
  stale_24h_count: number;
  stale_72h_count: number;
  oldest_open_at: string | null;
}

interface SupportSessionEventRow {
  id: string;
  session_id: string;
  event_type: "bot_message" | "user_choice" | "user_text" | "escalation";
  node_id: string | null;
  payload_json: string;
  created_at: string;
}

type JsonObject = Record<string, unknown>;

interface ResolvedSupportActor {
  subjectId: string;
  locale: UserLocale;
  anonymousToken: string | null;
  deviceToken: string | null;
}

const SUPPORT_THREAD_SELECT_SQL = `
  SELECT
    st.id,
    st.user_id,
    st.source_session_id,
    st.entry_topic,
    st.summary,
    st.status,
    st.created_at,
    st.updated_at,
    st.closed_at,
    st.closed_by,
    st.user_acknowledged_at,
    u.name AS user_name,
    u.email AS user_email,
    (
      SELECT text
      FROM support_messages sm
      WHERE sm.thread_id = st.id
      ORDER BY sm.created_at DESC, sm.id DESC
      LIMIT 1
    ) AS last_message,
    (
      SELECT sender_role
      FROM support_messages sm
      WHERE sm.thread_id = st.id
      ORDER BY sm.created_at DESC, sm.id DESC
      LIMIT 1
    ) AS last_sender_role,
    EXISTS(
      SELECT 1
      FROM support_messages sm2
      WHERE sm2.thread_id = st.id AND sm2.sender_role = 'platform_admin'
    ) AS has_admin_reply,
    (
      SELECT created_at
      FROM support_messages sm3
      WHERE sm3.thread_id = st.id AND sm3.sender_role = 'user'
      ORDER BY sm3.created_at DESC, sm3.id DESC
      LIMIT 1
    ) AS last_user_message_at,
    (
      SELECT created_at
      FROM support_messages sm4
      WHERE sm4.thread_id = st.id AND sm4.sender_role = 'platform_admin'
      ORDER BY sm4.created_at DESC, sm4.id DESC
      LIMIT 1
    ) AS last_admin_message_at,
    ur.read_at AS user_read_at,
    ar.read_at AS admin_read_at
  FROM support_threads st
  LEFT JOIN users u ON u.id = st.user_id
  LEFT JOIN support_thread_reads ur ON ur.thread_id = st.id AND ur.actor_role = 'user'
  LEFT JOIN support_thread_reads ar ON ar.thread_id = st.id AND ar.actor_role = 'platform_admin'
`;

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getSupportActorType(userId: string): "guest" | "logged_in" {
  return isAnonymousSupportSubjectId(userId) ? "guest" : "logged_in";
}

function getSupportWaitingOn(thread: SupportThreadRow): "user" | "platform_admin" | null {
  if (thread.status !== "open") return null;
  return thread.last_sender_role === "platform_admin" ? "user" : "platform_admin";
}

function getSupportLastAction(thread: SupportThreadRow): "ticket_created" | "user_replied" | "admin_replied" | "user_closed" | "admin_closed" {
  if (thread.status === "closed") {
    return thread.closed_by === thread.user_id ? "user_closed" : "admin_closed";
  }
  if (thread.last_sender_role === "platform_admin") return "admin_replied";
  if (thread.last_sender_role === "user" && !!thread.has_admin_reply) return "user_replied";
  return "ticket_created";
}

function isUnreadSince(messageAt: string | null | undefined, readAt: string | null | undefined): boolean {
  const messageMs = parseIsoMs(messageAt);
  if (!messageMs) return false;
  const readMs = parseIsoMs(readAt);
  return readMs === null || messageMs > readMs;
}

function getSupportStaleLevel(thread: SupportThreadRow, nowMs: number): "none" | "stale" | "critical" {
  if (thread.status !== "open") return "none";
  const updatedMs = parseIsoMs(thread.updated_at);
  if (updatedMs === null) return "none";
  const ageMs = Math.max(0, nowMs - updatedMs);
  if (ageMs >= SUPPORT_CRITICAL_STALE_MS) return "critical";
  if (ageMs >= SUPPORT_STALE_MS) return "stale";
  return "none";
}

function parseEventPayload(row: SupportSessionEventRow): SupportTranscriptEvent {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.payload_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {}
  return {
    id: row.id,
    event_type: row.event_type,
    node_id: row.node_id,
    payload,
    created_at: row.created_at,
  };
}

function serializeNode(node: SupportNode | null) {
  if (!node) return null;
  return {
    id: node.id,
    kind: node.kind,
    messages: node.messages,
    choices: node.choices || [],
    placeholder: node.placeholder || "",
    submitLabel: node.submitLabel || "",
    escalationLabel: node.escalationLabel || "",
    resolution: node.resolution || null,
  };
}

function serializeThread(row: SupportThreadRow, locale: UserLocale, nowMs = Date.now()) {
  const hasAdminReply = !!row.has_admin_reply;
  const canUserSend = row.status === "open" && hasAdminReply && row.last_sender_role === "platform_admin";
  const createdMs = parseIsoMs(row.created_at);
  return {
    id: row.id,
    user_id: row.user_id,
    source_session_id: row.source_session_id,
    entry_topic: row.entry_topic,
    entry_topic_label: supportTopicLabel(row.entry_topic, locale),
    summary: row.summary,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at,
    closed_by: row.closed_by,
    requires_user_acknowledgement: row.status === "closed"
      && row.closed_by !== row.user_id
      && !row.user_acknowledged_at,
    user_name: row.user_name || null,
    user_email: row.user_email || null,
    last_message: row.last_message || null,
    has_admin_reply: hasAdminReply,
    can_user_send: canUserSend,
    actor_type: getSupportActorType(row.user_id),
    waiting_on: getSupportWaitingOn(row),
    last_action: getSupportLastAction(row),
    unread_for_user: isUnreadSince(row.last_admin_message_at, row.user_read_at),
    unread_for_admin: isUnreadSince(row.last_user_message_at, row.admin_read_at),
    stale_level: getSupportStaleLevel(row, nowMs),
    open_duration_minutes: createdMs === null ? 0 : Math.max(0, Math.floor((nowMs - createdMs) / 60_000)),
  };
}

function serializeSession(row: SupportSessionRow, locale: UserLocale) {
  return {
    id: row.id,
    status: row.status,
    entry_topic: row.entry_topic,
    entry_topic_label: supportTopicLabel(row.entry_topic, locale),
    current_node_id: row.current_node_id,
    resolved_via_tree: !!row.resolved_via_tree,
    escalated_thread_id: row.escalated_thread_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}

function isAnonymousSupportSubjectId(value: string): boolean {
  return value.startsWith(ANONYMOUS_SUPPORT_PREFIX);
}

function formatAnonymousSupportLabel(value: string, locale: UserLocale): string {
  const suffix = value.slice(ANONYMOUS_SUPPORT_PREFIX.length).slice(-6) || value.slice(-6);
  return locale === "en" ? `Anon #${suffix}` : `익명 #${suffix}`;
}

function formatSupportUserLabel(thread: SupportThreadRow, locale: UserLocale): string {
  if (thread.user_name?.trim()) return thread.user_name.trim();
  if (thread.user_email?.trim()) return thread.user_email.trim();
  if (isAnonymousSupportSubjectId(thread.user_id)) {
    return formatAnonymousSupportLabel(thread.user_id, locale);
  }
  return thread.user_id;
}

async function parseJsonObject(request: Request): Promise<JsonObject | null> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }
    return body as JsonObject;
  } catch {
    return null;
  }
}

async function requireTrustedUserId(request: Request, env: Env): Promise<string | null> {
  return getTrustedUserId(request, env);
}

async function requirePlatformAdminUserId(request: Request, env: Env): Promise<string | null> {
  const userId = await requireTrustedUserId(request, env);
  if (!userId) return null;
  return await isReportsChannelOwner(userId, env) ? userId : null;
}

function parseSupportRequestLocale(request: Request): UserLocale {
  const value = (request.headers.get("X-Locale") || request.headers.get("Accept-Language") || "").toLowerCase();
  return value.startsWith("en") ? "en" : "ko";
}

async function resolveSupportActor(request: Request, env: Env): Promise<ResolvedSupportActor> {
  const userId = await requireTrustedUserId(request, env);
  if (userId) {
    return {
      subjectId: userId,
      locale: await getUserLocale(userId, env),
      anonymousToken: null,
      deviceToken: null,
    };
  }

  const anonymousToken = request.headers.get("X-Anonymous-Token") || "";
  const deviceToken = request.headers.get("X-Device-Token") || "";
  const verifiedAnonymous = anonymousToken
    ? await verifyAnonymousIdentityToken(anonymousToken, env)
    : null;
  const verifiedDevice = deviceToken
    ? await verifyDeviceIdentityToken(deviceToken, env)
    : null;
  const anonymousIdentity = verifiedAnonymous
    ? { uid: verifiedAnonymous.uid, token: anonymousToken }
    : await createAnonymousIdentity(env);
  const deviceIdentity = verifiedDevice
    ? { deviceId: verifiedDevice.device_id, token: deviceToken }
    : await createDeviceIdentity(env);

  return {
    subjectId: `${ANONYMOUS_SUPPORT_PREFIX}${anonymousIdentity.uid}`,
    locale: parseSupportRequestLocale(request),
    anonymousToken: anonymousIdentity.token,
    deviceToken: deviceIdentity.token,
  };
}

function withSupportIdentityHeaders(response: Response, actor: ResolvedSupportActor): Response {
  if (!actor.anonymousToken && !actor.deviceToken) return response;
  const headers = new Headers(response.headers);
  if (actor.anonymousToken) headers.set("X-Anonymous-Token", actor.anonymousToken);
  if (actor.deviceToken) headers.set("X-Device-Token", actor.deviceToken);
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

async function applySupportRateLimit(input: {
  env: Env;
  scope: string;
  userId: string;
  limit: number;
}): Promise<Response | null> {
  const result = await consumeDurableRateLimit({
    env: input.env,
    scope: input.scope,
    subjectKey: input.userId,
    limit: input.limit,
    windowMs: SUPPORT_RATE_LIMIT_WINDOW_MS,
  });
  return result.ok ? null : Response.json({ error: "rate_limited" }, { status: 429 });
}

async function fetchOpenSupportThreadForUser(userId: string, env: Env): Promise<SupportThreadRow | null> {
  return env.DB.prepare(`
    ${SUPPORT_THREAD_SELECT_SQL}
    WHERE st.user_id = ? AND st.status = 'open'
    ORDER BY st.updated_at DESC, st.id DESC
    LIMIT 1
  `).bind(userId).first<SupportThreadRow>();
}

async function fetchVisibleSupportThreadForUser(userId: string, env: Env): Promise<SupportThreadRow | null> {
  return env.DB.prepare(`
    ${SUPPORT_THREAD_SELECT_SQL}
    WHERE st.user_id = ?
      AND (
        st.status = 'open'
        OR (
          st.status = 'closed'
          AND st.closed_by IS NOT NULL
          AND st.closed_by != st.user_id
          AND st.user_acknowledged_at IS NULL
        )
      )
    ORDER BY CASE WHEN st.status = 'open' THEN 0 ELSE 1 END, st.updated_at DESC, st.id DESC
    LIMIT 1
  `).bind(userId).first<SupportThreadRow>();
}

async function fetchOpenSupportSessionForUser(userId: string, env: Env): Promise<SupportSessionRow | null> {
  return env.DB.prepare(`
    SELECT
      id,
      user_id,
      status,
      entry_topic,
      current_node_id,
      resolved_via_tree,
      escalated_thread_id,
      created_at,
      updated_at,
      completed_at
    FROM support_sessions
    WHERE user_id = ? AND status = 'open'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).bind(userId).first<SupportSessionRow>();
}

async function fetchSupportSessionById(sessionId: string, env: Env): Promise<SupportSessionRow | null> {
  return env.DB.prepare(`
    SELECT
      id,
      user_id,
      status,
      entry_topic,
      current_node_id,
      resolved_via_tree,
      escalated_thread_id,
      created_at,
      updated_at,
      completed_at
    FROM support_sessions
    WHERE id = ?
    LIMIT 1
  `).bind(sessionId).first<SupportSessionRow>();
}

async function fetchSupportThreadById(threadId: string, env: Env): Promise<SupportThreadRow | null> {
  return env.DB.prepare(`
    ${SUPPORT_THREAD_SELECT_SQL}
    WHERE st.id = ?
    LIMIT 1
  `).bind(threadId).first<SupportThreadRow>();
}

async function fetchSupportSessionEvents(sessionId: string, env: Env): Promise<SupportTranscriptEvent[]> {
  const { results } = await env.DB.prepare(`
    SELECT id, session_id, event_type, node_id, payload_json, created_at
    FROM support_session_events
    WHERE session_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).bind(sessionId).all<SupportSessionEventRow>();
  return (results || []).map(parseEventPayload);
}

async function fetchSupportMessages(
  threadId: string,
  env: Env,
  after?: { createdAt: string; id: string } | null,
): Promise<SupportMessageRow[]> {
  const cursorClause = after
    ? "AND (created_at > ? OR (created_at = ? AND id > ?))"
    : "";
  const { results } = await env.DB.prepare(`
    SELECT id, thread_id, sender_role, sender_user_id, text, created_at
    FROM support_messages
    WHERE thread_id = ?
      ${cursorClause}
    ORDER BY created_at ASC, id ASC
  `).bind(
    threadId,
    ...(after ? [after.createdAt, after.createdAt, after.id] : []),
  ).all<SupportMessageRow>();
  return results || [];
}

async function markSupportThreadRead(input: {
  env: Env;
  threadId: string;
  actorRole: "user" | "platform_admin";
  readAt?: string;
}): Promise<void> {
  await input.env.DB.prepare(`
    INSERT INTO support_thread_reads (thread_id, actor_role, read_at)
    VALUES (?, ?, ?)
    ON CONFLICT(thread_id, actor_role)
    DO UPDATE SET read_at = excluded.read_at
  `).bind(
    input.threadId,
    input.actorRole,
    input.readAt || new Date().toISOString(),
  ).run();
}

async function insertBotMessages(input: {
  env: Env;
  sessionId: string;
  nodeId: string;
  createdAt: string;
  messages: string[];
}): Promise<void> {
  if (input.messages.length === 0) return;
  await input.env.DB.batch(
    input.messages.map((message) => input.env.DB.prepare(`
      INSERT INTO support_session_events (id, session_id, event_type, node_id, payload_json, created_at)
      VALUES (?, ?, 'bot_message', ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.sessionId,
      input.nodeId,
      JSON.stringify({ text: message }),
      input.createdAt,
    ))
  );
}

async function buildOpenSupportThreadResponse(input: {
  env: Env;
  locale: UserLocale;
  thread: SupportThreadRow;
}): Promise<Response> {
  const messages = await fetchSupportMessages(input.thread.id, input.env);
  return Response.json({
    thread: serializeThread(input.thread, input.locale),
    messages,
    session: null,
    transcript: [],
    currentNode: null,
  });
}

async function reuseOpenSupportThread(input: {
  env: Env;
  locale: UserLocale;
  session: SupportSessionRow;
  thread: SupportThreadRow;
  entryTopic: string | null;
  escalationNodeId: string;
}): Promise<Response> {
  const createdAt = new Date().toISOString();
  await input.env.DB.batch([
    input.env.DB.prepare(`
      INSERT INTO support_session_events (id, session_id, event_type, node_id, payload_json, created_at)
      VALUES (?, ?, 'escalation', ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.session.id,
      input.escalationNodeId,
      JSON.stringify({ thread_id: input.thread.id, reused_existing_thread: true }),
      createdAt,
    ),
    input.env.DB.prepare(`
      UPDATE support_sessions
      SET entry_topic = ?, current_node_id = ?, status = 'escalated', escalated_thread_id = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'open'
    `).bind(
      input.entryTopic,
      input.escalationNodeId,
      input.thread.id,
      createdAt,
      createdAt,
      input.session.id,
    ),
  ]);
  return buildOpenSupportThreadResponse(input);
}

async function createEscalatedSupportThread(input: {
  env: Env;
  locale: UserLocale;
  session: SupportSessionRow;
  userId: string;
  entryTopic: string | null;
  escalationNodeId: string;
}): Promise<Response> {
  const existingThread = await fetchOpenSupportThreadForUser(input.userId, input.env);
  if (existingThread) {
    return reuseOpenSupportThread({
      ...input,
      thread: existingThread,
    });
  }

  const transcript = await fetchSupportSessionEvents(input.session.id, input.env);
  const summary = buildSupportSummary({
    locale: input.locale,
    topic: input.entryTopic,
    events: transcript,
  });
  const threadId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    await input.env.DB.batch([
      input.env.DB.prepare(`
        INSERT INTO support_threads (
          id, user_id, source_session_id, entry_topic, summary, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
      `).bind(threadId, input.userId, input.session.id, input.entryTopic, summary, createdAt, createdAt),
      input.env.DB.prepare(`
        INSERT INTO support_messages (id, thread_id, sender_role, sender_user_id, text, created_at)
        VALUES (?, ?, 'user', ?, ?, ?)
      `).bind(messageId, threadId, input.userId, summary, createdAt),
      input.env.DB.prepare(`
        INSERT INTO support_session_events (id, session_id, event_type, node_id, payload_json, created_at)
        VALUES (?, ?, 'escalation', ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        input.session.id,
        input.escalationNodeId,
        JSON.stringify({ thread_id: threadId, summary }),
        createdAt,
      ),
      input.env.DB.prepare(`
        UPDATE support_sessions
        SET entry_topic = ?, current_node_id = ?, status = 'escalated', escalated_thread_id = ?, updated_at = ?, completed_at = ?
        WHERE id = ? AND status = 'open'
      `).bind(input.entryTopic, input.escalationNodeId, threadId, createdAt, createdAt, input.session.id),
    ]);
  } catch (error) {
    const concurrentThread = await fetchOpenSupportThreadForUser(input.userId, input.env);
    if (!concurrentThread) throw error;
    const latestSession = await fetchSupportSessionById(input.session.id, input.env);
    if (latestSession?.status !== "open") {
      return buildOpenSupportThreadResponse({
        env: input.env,
        locale: input.locale,
        thread: concurrentThread,
      });
    }
    return reuseOpenSupportThread({
      ...input,
      session: latestSession,
      thread: concurrentThread,
    });
  }

  await markSupportThreadRead({
    env: input.env,
    threadId,
    actorRole: "user",
    readAt: createdAt,
  });
  await appendSupportAuditLog({
    env: input.env,
    threadId,
    actorRole: "user",
    actorUserId: input.userId,
    action: "ticket_created",
    detail: {
      actor_type: getSupportActorType(input.userId),
      entry_topic: input.entryTopic,
      source_session_id: input.session.id,
    },
  });
  await recordOperationalEvent({
    env: input.env,
    severity: "info",
    route: "/api/support",
    eventType: "support_ticket_created",
    actorUserId: input.userId,
    targetId: threadId,
    detail: {
      actorType: getSupportActorType(input.userId),
      entryTopic: input.entryTopic,
      summaryLength: summary.length,
    },
  });

  const [thread, messages] = await Promise.all([
    fetchSupportThreadById(threadId, input.env),
    fetchSupportMessages(threadId, input.env),
  ]);
  return Response.json({
    thread: thread ? serializeThread(thread, input.locale) : null,
    messages,
    session: null,
    transcript: [],
    currentNode: null,
  });
}

async function buildUserSupportState(subjectId: string, locale: UserLocale, env: Env): Promise<Response> {
  const [platformAdmin, openSession, openThread] = await Promise.all([
    isAnonymousSupportSubjectId(subjectId) ? Promise.resolve(false) : isReportsChannelOwner(subjectId, env),
    fetchOpenSupportSessionForUser(subjectId, env),
    fetchVisibleSupportThreadForUser(subjectId, env),
  ]);
  if (openSession) {
    const [transcript, messages] = await Promise.all([
      fetchSupportSessionEvents(openSession.id, env),
      openThread ? fetchSupportMessages(openThread.id, env) : Promise.resolve<SupportMessageRow[]>([]),
    ]);
    const currentNode = getSupportNode(openSession.current_node_id, locale);
    return Response.json({
      platformAdmin,
      thread: openThread ? serializeThread(openThread, locale) : null,
      messages,
      session: serializeSession(openSession, locale),
      transcript,
      currentNode: serializeNode(currentNode),
    });
  }

  if (openThread) {
    const messages = await fetchSupportMessages(openThread.id, env);
    return Response.json({
      platformAdmin,
      thread: serializeThread(openThread, locale),
      messages,
      session: null,
      transcript: [],
      currentNode: null,
    });
  }

  return Response.json({
    platformAdmin,
    thread: null,
    messages: [],
    session: null,
    transcript: [],
    currentNode: null,
  });
}

async function buildUserSupportPreview(subjectId: string, locale: UserLocale, env: Env): Promise<Response> {
  const openThread = await fetchVisibleSupportThreadForUser(subjectId, env);
  return Response.json({
    thread: openThread ? serializeThread(openThread, locale) : null,
  });
}

function getNextTextNodeId(currentNodeId: string): string {
  if (currentNodeId.endsWith("-details")) {
    return currentNodeId.replace(/-details$/, "-escalate");
  }
  return "resolved";
}

async function handleSupportStartSession(subjectId: string, locale: UserLocale, env: Env): Promise<Response> {
  const rateLimited = await applySupportRateLimit({
    env,
    scope: "support-session-start",
    userId: subjectId,
    limit: SUPPORT_START_LIMIT,
  });
  if (rateLimited) return rateLimited;

  const [existingThread, existingSession] = await Promise.all([
    fetchOpenSupportThreadForUser(subjectId, env),
    fetchOpenSupportSessionForUser(subjectId, env),
  ]);
  if (existingSession) {
    const [transcript, messages] = await Promise.all([
      fetchSupportSessionEvents(existingSession.id, env),
      existingThread ? fetchSupportMessages(existingThread.id, env) : Promise.resolve<SupportMessageRow[]>([]),
    ]);
    return Response.json({
      thread: existingThread ? serializeThread(existingThread, locale) : null,
      messages,
      session: serializeSession(existingSession, locale),
      transcript,
      currentNode: serializeNode(getSupportNode(existingSession.current_node_id, locale)),
    });
  }

  const sessionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare(`
      INSERT INTO support_sessions (
        id, user_id, status, current_node_id, created_at, updated_at
      ) VALUES (?, ?, 'open', 'start', ?, ?)
    `).bind(sessionId, subjectId, createdAt, createdAt).run();
  } catch (error) {
    const concurrentSession = await fetchOpenSupportSessionForUser(subjectId, env);
    if (!concurrentSession) throw error;
    const [transcript, messages] = await Promise.all([
      fetchSupportSessionEvents(concurrentSession.id, env),
      existingThread ? fetchSupportMessages(existingThread.id, env) : Promise.resolve<SupportMessageRow[]>([]),
    ]);
    return Response.json({
      thread: existingThread ? serializeThread(existingThread, locale) : null,
      messages,
      session: serializeSession(concurrentSession, locale),
      transcript,
      currentNode: serializeNode(getSupportNode(concurrentSession.current_node_id, locale)),
    });
  }
  await insertBotMessages({
    env,
    sessionId,
    nodeId: "start",
    createdAt,
    messages: buildSupportFlow(locale).start.messages,
  });

  const [session, transcript, messages] = await Promise.all([
    fetchSupportSessionById(sessionId, env),
    fetchSupportSessionEvents(sessionId, env),
    existingThread ? fetchSupportMessages(existingThread.id, env) : Promise.resolve<SupportMessageRow[]>([]),
  ]);
  return Response.json({
    thread: existingThread ? serializeThread(existingThread, locale) : null,
    messages,
    session: session ? serializeSession(session, locale) : null,
    transcript,
    currentNode: serializeNode(getSupportNode("start", locale)),
  });
}

async function handleSupportAnswerSession(body: JsonObject, subjectId: string, locale: UserLocale, env: Env): Promise<Response> {
  const rateLimited = await applySupportRateLimit({
    env,
    scope: "support-session-answer",
    userId: subjectId,
    limit: SUPPORT_ANSWER_LIMIT,
  });
  if (rateLimited) return rateLimited;

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!sessionId) {
    return Response.json({ error: "missing session_id" }, { status: 400 });
  }

  const session = await fetchSupportSessionById(sessionId, env);
  if (!session || session.user_id !== subjectId || session.status !== "open") {
    return Response.json({ error: "session_not_found" }, { status: 404 });
  }

  const node = getSupportNode(session.current_node_id, locale);
  if (!node || node.kind === "terminal" || node.kind === "escalate") {
    return Response.json({ error: "invalid_state" }, { status: 409 });
  }

  const createdAt = new Date().toISOString();
  let nextNodeId = session.current_node_id;
  let nextEntryTopic = session.entry_topic;

  if (node.kind === "choice") {
    const choiceId = typeof body.choice_id === "string" ? body.choice_id : "";
    const choice = (node.choices || []).find((item) => item.id === choiceId);
    if (!choice) {
      return Response.json({ error: "invalid_choice" }, { status: 400 });
    }
    nextNodeId = choice.next;
    nextEntryTopic = choice.topic || nextEntryTopic || null;
    await env.DB.prepare(`
      INSERT INTO support_session_events (id, session_id, event_type, node_id, payload_json, created_at)
      VALUES (?, ?, 'user_choice', ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      session.id,
      node.id,
      JSON.stringify({ choice_id: choice.id, label: choice.label }),
      createdAt,
    ).run();
  } else {
    const text = typeof body.text === "string" ? body.text.trim().slice(0, SUPPORT_SESSION_TEXT_MAX_LENGTH) : "";
    if (!text) {
      return Response.json({ error: "text_required" }, { status: 400 });
    }
    nextNodeId = getNextTextNodeId(node.id);
    await env.DB.prepare(`
      INSERT INTO support_session_events (id, session_id, event_type, node_id, payload_json, created_at)
      VALUES (?, ?, 'user_text', ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      session.id,
      node.id,
      JSON.stringify({ text }),
      createdAt,
    ).run();
  }

  const nextNode = getSupportNode(nextNodeId, locale);
  if (!nextNode) {
    return Response.json({ error: "flow_not_found" }, { status: 500 });
  }
  if (nextNode.kind === "escalate") {
    return createEscalatedSupportThread({
      env,
      locale,
      session,
      userId: subjectId,
      entryTopic: nextEntryTopic,
      escalationNodeId: nextNode.id,
    });
  }

  await insertBotMessages({
    env,
    sessionId: session.id,
    nodeId: nextNode.id,
    createdAt,
    messages: nextNode.messages,
  });

  const terminalResolved = nextNode.kind === "terminal" && nextNode.resolution === "resolved";
  await env.DB.prepare(`
    UPDATE support_sessions
    SET entry_topic = ?, current_node_id = ?, status = ?, resolved_via_tree = ?, updated_at = ?, completed_at = ?
    WHERE id = ?
  `).bind(
    nextEntryTopic,
    nextNode.id,
    terminalResolved ? "resolved" : "open",
    terminalResolved ? 1 : 0,
    createdAt,
    terminalResolved ? createdAt : null,
    session.id,
  ).run();

  const [updatedSession, transcript] = await Promise.all([
    fetchSupportSessionById(session.id, env),
    fetchSupportSessionEvents(session.id, env),
  ]);
  return Response.json({
    thread: null,
    messages: [],
    session: updatedSession ? serializeSession(updatedSession, locale) : null,
    transcript,
    currentNode: serializeNode(nextNode),
  });
}

async function handleSupportEscalateSession(body: JsonObject, subjectId: string, locale: UserLocale, env: Env): Promise<Response> {
  const rateLimited = await applySupportRateLimit({
    env,
    scope: "support-session-escalate",
    userId: subjectId,
    limit: SUPPORT_START_LIMIT,
  });
  if (rateLimited) return rateLimited;

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!sessionId) {
    return Response.json({ error: "missing session_id" }, { status: 400 });
  }

  const session = await fetchSupportSessionById(sessionId, env);
  if (!session || session.user_id !== subjectId || session.status !== "open") {
    return Response.json({ error: "session_not_found" }, { status: 404 });
  }
  const currentNode = getSupportNode(session.current_node_id, locale);
  if (!currentNode || currentNode.kind !== "escalate") {
    return Response.json({ error: "invalid_state" }, { status: 409 });
  }

  return createEscalatedSupportThread({
      env,
      locale,
      session,
      userId: subjectId,
      entryTopic: session.entry_topic,
      escalationNodeId: currentNode.id,
    });
}

async function handleSupportClearSession(body: JsonObject, subjectId: string, env: Env): Promise<Response> {
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!sessionId) {
    return Response.json({ error: "missing session_id" }, { status: 400 });
  }

  const session = await fetchSupportSessionById(sessionId, env);
  if (!session || session.user_id !== subjectId) {
    return Response.json({ error: "session_not_found" }, { status: 404 });
  }

  if (session.status === "open") {
    const completedAt = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE support_sessions
      SET status = 'abandoned', updated_at = ?, completed_at = ?
      WHERE id = ?
    `).bind(completedAt, completedAt, session.id).run();
  }

  return Response.json({ ok: true });
}

async function handleUserSupportThreadMessage(body: JsonObject, subjectId: string, env: Env): Promise<Response> {
  const rateLimited = await applySupportRateLimit({
    env,
    scope: "support-thread-message",
    userId: subjectId,
    limit: SUPPORT_MESSAGE_LIMIT,
  });
  if (rateLimited) return rateLimited;

  const threadId = typeof body.thread_id === "string" ? body.thread_id : "";
  const text = typeof body.text === "string" ? body.text.trim().slice(0, SUPPORT_TEXT_MAX_LENGTH) : "";
  if (!threadId || !text) {
    return Response.json({ error: "missing required fields" }, { status: 400 });
  }

  const thread = await fetchSupportThreadById(threadId, env);
  if (!thread || thread.user_id !== subjectId || thread.status !== "open") {
    return Response.json({ error: "thread_not_found" }, { status: 404 });
  }
  if (!thread.has_admin_reply || thread.last_sender_role !== "platform_admin") {
    return Response.json({ error: "await_admin_reply" }, { status: 409 });
  }

  const createdAt = new Date().toISOString();
  const messageId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO support_messages (id, thread_id, sender_role, sender_user_id, text, created_at)
      VALUES (?, ?, 'user', ?, ?, ?)
    `).bind(messageId, threadId, subjectId, text, createdAt),
    env.DB.prepare(`
      UPDATE support_threads
      SET updated_at = ?
      WHERE id = ?
    `).bind(createdAt, threadId),
  ]);
  await markSupportThreadRead({
    env,
    threadId,
    actorRole: "user",
    readAt: createdAt,
  });
  await appendSupportAuditLog({
    env,
    threadId,
    actorRole: "user",
    actorUserId: subjectId,
    action: "user_replied",
    detail: {
      text_length: text.length,
    },
  });
  await recordOperationalEvent({
    env,
    severity: "info",
    route: "/api/support",
    eventType: "support_user_replied",
    actorUserId: subjectId,
    targetId: threadId,
    detail: {
      textLength: text.length,
    },
  });
  return Response.json({
    ok: true,
    message: {
      id: messageId,
      thread_id: threadId,
      sender_role: "user",
      sender_user_id: subjectId,
      text,
      created_at: createdAt,
    },
  });
}

async function closeSupportThreadRecord(
  threadId: string,
  actorUserId: string,
  actorRole: "user" | "platform_admin",
  env: Env,
  existingThread?: SupportThreadRow | null,
): Promise<Response> {
  const thread = existingThread ?? await fetchSupportThreadById(threadId, env);
  if (!thread || thread.status !== "open") {
    return Response.json({ error: "thread_not_found" }, { status: 404 });
  }
  const closedAt = new Date().toISOString();
  if (actorRole === "platform_admin") {
    const userLocale = await getUserLocale(thread.user_id, env);
    const closureText = userLocale === "en"
      ? "This support ticket has been closed."
      : "1:1 문의가 종료되었습니다.";
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE support_threads
        SET status = 'closed', updated_at = ?, closed_at = ?, closed_by = ?,
            user_acknowledged_at = NULL
        WHERE id = ?
      `).bind(closedAt, closedAt, actorUserId, threadId),
      env.DB.prepare(`
        INSERT INTO support_messages (id, thread_id, sender_role, sender_user_id, text, created_at)
        VALUES (?, ?, 'platform_admin', ?, ?, ?)
      `).bind(crypto.randomUUID(), threadId, actorUserId, closureText, closedAt),
    ]);
  } else {
    await env.DB.prepare(`
      UPDATE support_threads
      SET status = 'closed', updated_at = ?, closed_at = ?, closed_by = ?
      WHERE id = ?
    `).bind(closedAt, closedAt, actorUserId, threadId).run();
  }
  const action = actorRole === "user" ? "user_closed" : "admin_closed";
  await appendSupportAuditLog({
    env,
    threadId,
    actorRole,
    actorUserId,
    action,
    detail: {
      actor_type: actorRole === "user" ? getSupportActorType(thread.user_id) : "platform_admin",
    },
  });
  await recordOperationalEvent({
    env,
    severity: "info",
    route: actorRole === "user" ? "/api/support" : "/api/platform-admin/support",
    eventType: actorRole === "user" ? "support_user_closed" : "support_admin_closed",
    actorUserId,
    targetId: threadId,
    detail: {
      waitingOn: getSupportWaitingOn(thread),
      openDurationMinutes: serializeThread(thread, "en", parseIsoMs(closedAt) || Date.now()).open_duration_minutes,
    },
  });
  return Response.json({ ok: true });
}

async function handleUserSupportCloseThread(body: JsonObject, subjectId: string, env: Env): Promise<Response> {
  const threadId = typeof body.thread_id === "string" ? body.thread_id : "";
  if (!threadId) {
    return Response.json({ error: "missing thread_id" }, { status: 400 });
  }

  const thread = await fetchSupportThreadById(threadId, env);
  if (!thread || thread.user_id !== subjectId) {
    return Response.json({ error: "thread_not_found" }, { status: 404 });
  }

  if (thread.status === "closed") {
    if (
      thread.closed_by
      && thread.closed_by !== thread.user_id
      && !thread.user_acknowledged_at
    ) {
      return handleUserSupportAcknowledgeClosure(body, subjectId, env);
    }
    return Response.json({ ok: true });
  }

  if (thread.status !== "open") {
    return Response.json({ error: "thread_not_found" }, { status: 404 });
  }

  return closeSupportThreadRecord(threadId, subjectId, "user", env, thread);
}

async function handleUserSupportMarkThreadRead(body: JsonObject, subjectId: string, env: Env): Promise<Response> {
  const threadId = typeof body.thread_id === "string" ? body.thread_id : "";
  if (!threadId) {
    return Response.json({ error: "missing thread_id" }, { status: 400 });
  }

  const thread = await fetchSupportThreadById(threadId, env);
  if (!thread || thread.user_id !== subjectId) {
    return Response.json({ error: "thread_not_found" }, { status: 404 });
  }

  await markSupportThreadRead({
    env,
    threadId,
    actorRole: "user",
  });
  return Response.json({ ok: true });
}

async function handleUserSupportAcknowledgeClosure(body: JsonObject, subjectId: string, env: Env): Promise<Response> {
  const threadId = typeof body.thread_id === "string" ? body.thread_id : "";
  if (!threadId) {
    return Response.json({ error: "missing thread_id" }, { status: 400 });
  }

  const thread = await fetchSupportThreadById(threadId, env);
  if (
    !thread
    || thread.user_id !== subjectId
    || thread.status !== "closed"
    || thread.closed_by === thread.user_id
  ) {
    return Response.json({ error: "thread_not_found" }, { status: 404 });
  }
  if (thread.user_acknowledged_at) {
    return Response.json({ ok: true });
  }

  const acknowledgedAt = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE support_threads
    SET user_acknowledged_at = ?
    WHERE id = ? AND user_id = ? AND user_acknowledged_at IS NULL
  `).bind(acknowledgedAt, threadId, subjectId).run();
  await appendSupportAuditLog({
    env,
    threadId,
    actorRole: "user",
    actorUserId: subjectId,
    action: "user_acknowledged_closure",
  });
  return Response.json({ ok: true });
}

export async function handleSupport(request: Request, env: Env): Promise<Response> {
  const actor = await resolveSupportActor(request, env);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "state";
    if (type === "preview") {
      return withSupportIdentityHeaders(await buildUserSupportPreview(actor.subjectId, actor.locale, env), actor);
    }
    return withSupportIdentityHeaders(await buildUserSupportState(actor.subjectId, actor.locale, env), actor);
  }

  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const body = await parseJsonObject(request);
  if (!body) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "start_session") {
    return withSupportIdentityHeaders(await handleSupportStartSession(actor.subjectId, actor.locale, env), actor);
  }
  if (action === "answer_session") {
    return withSupportIdentityHeaders(await handleSupportAnswerSession(body, actor.subjectId, actor.locale, env), actor);
  }
  if (action === "escalate_session") {
    return withSupportIdentityHeaders(await handleSupportEscalateSession(body, actor.subjectId, actor.locale, env), actor);
  }
  if (action === "clear_session") {
    return withSupportIdentityHeaders(await handleSupportClearSession(body, actor.subjectId, env), actor);
  }
  if (action === "send_thread_message") {
    return withSupportIdentityHeaders(await handleUserSupportThreadMessage(body, actor.subjectId, env), actor);
  }
  if (action === "close_thread") {
    return withSupportIdentityHeaders(await handleUserSupportCloseThread(body, actor.subjectId, env), actor);
  }
  if (action === "mark_thread_read") {
    return withSupportIdentityHeaders(await handleUserSupportMarkThreadRead(body, actor.subjectId, env), actor);
  }
  if (action === "acknowledge_closure") {
    return withSupportIdentityHeaders(await handleUserSupportAcknowledgeClosure(body, actor.subjectId, env), actor);
  }
  return Response.json({ error: "invalid_action" }, { status: 400 });
}

async function readPlatformDashboardStats(env: Env): Promise<PlatformDashboardStatsRow | null> {
  return env.DB.prepare(`
    WITH message_rollup AS (
      SELECT
        thread_id,
        MAX(CASE WHEN sender_role = 'user' THEN support_messages.created_at END) AS last_user_message_at,
        MAX(CASE WHEN sender_role = 'platform_admin' THEN support_messages.created_at END) AS last_admin_message_at
      FROM support_messages
      INNER JOIN support_threads open_threads ON open_threads.id = support_messages.thread_id AND open_threads.status = 'open'
      GROUP BY thread_id
    )
    SELECT
      COUNT(*) AS open_count,
      SUM(CASE WHEN mr.last_admin_message_at IS NULL OR mr.last_user_message_at > mr.last_admin_message_at THEN 1 ELSE 0 END) AS waiting_for_admin_count,
      SUM(CASE WHEN mr.last_admin_message_at IS NOT NULL AND (mr.last_user_message_at IS NULL OR mr.last_admin_message_at >= mr.last_user_message_at) THEN 1 ELSE 0 END) AS waiting_for_user_count,
      SUM(CASE WHEN mr.last_user_message_at IS NOT NULL AND (ar.read_at IS NULL OR mr.last_user_message_at > ar.read_at) THEN 1 ELSE 0 END) AS unread_for_admin_count,
      SUM(CASE WHEN st.updated_at <= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS stale_24h_count,
      SUM(CASE WHEN st.updated_at <= datetime('now', '-72 hours') THEN 1 ELSE 0 END) AS stale_72h_count,
      MIN(st.created_at) AS oldest_open_at
    FROM support_threads st
    LEFT JOIN message_rollup mr ON mr.thread_id = st.id
    LEFT JOIN support_thread_reads ar ON ar.thread_id = st.id AND ar.actor_role = 'platform_admin'
    WHERE st.status = 'open'
  `).first<PlatformDashboardStatsRow>();
}

function serializePlatformDashboardStats(row: PlatformDashboardStatsRow | null) {
  const oldestOpenMs = parseIsoMs(row?.oldest_open_at);
  return {
    open_count: Number(row?.open_count || 0),
    waiting_for_admin_count: Number(row?.waiting_for_admin_count || 0),
    waiting_for_user_count: Number(row?.waiting_for_user_count || 0),
    unread_for_admin_count: Number(row?.unread_for_admin_count || 0),
    stale_24h_count: Number(row?.stale_24h_count || 0),
    stale_72h_count: Number(row?.stale_72h_count || 0),
    oldest_open_duration_minutes: oldestOpenMs === null
      ? 0
      : Math.max(0, Math.floor((Date.now() - oldestOpenMs) / 60_000)),
  };
}

async function fetchPlatformSupportDashboard(requestUrl: URL, locale: UserLocale, env: Env): Promise<Response> {
  const reportsChannelId = getReportsChannelId(env);
  const includeStats = requestUrl.searchParams.get("include_stats") !== "0";
  const requestedOpenLimit = Number.parseInt(requestUrl.searchParams.get("open_limit") || "", 10);
  const openLimit = Number.isFinite(requestedOpenLimit)
    ? Math.min(Math.max(requestedOpenLimit, 1), SUPPORT_DASHBOARD_OPEN_TICKET_MAX_LIMIT)
    : SUPPORT_DASHBOARD_OPEN_TICKET_LIMIT;
  const openCursor = requestUrl.searchParams.get("open_cursor") || "";
  const cursorSeparator = openCursor.lastIndexOf("|");
  const cursorUpdatedAt = cursorSeparator > 0 ? openCursor.slice(0, cursorSeparator) : null;
  const cursorId = cursorSeparator > 0 ? openCursor.slice(cursorSeparator + 1) : null;

  const openStatement = env.DB.prepare(`
    ${SUPPORT_THREAD_SELECT_SQL}
    WHERE st.status = 'open'
      ${cursorUpdatedAt && cursorId ? "AND (st.updated_at < ? OR (st.updated_at = ? AND st.id < ?))" : ""}
    ORDER BY st.updated_at DESC, st.id DESC
    LIMIT ?
  `);
  const reportsChannelPromise = reportsChannelId
    ? env.DB.prepare(`
      SELECT id, name, profile_image, bubble_color, created_at
      FROM channels
      WHERE id = ?
      LIMIT 1
    `).bind(reportsChannelId).first<ReportsChannelRow>()
    : Promise.resolve<ReportsChannelRow | null>(null);
  const reportsSummaryPromise = reportsChannelId
    ? env.DB.prepare(`
      SELECT COUNT(*) AS open_report_count, MIN(created_at) AS oldest_report_at
      FROM channel_reports
      WHERE status = 'open'
    `).first<{ open_report_count: number; oldest_report_at: string | null }>()
    : Promise.resolve<{ open_report_count: number; oldest_report_at: string | null } | null>(null);
  const openResultsPromise = cursorUpdatedAt && cursorId
    ? openStatement.bind(cursorUpdatedAt, cursorUpdatedAt, cursorId, openLimit + 1).all<PlatformDashboardTicketRow>()
    : openStatement.bind(openLimit + 1).all<PlatformDashboardTicketRow>();
  const closedResultsPromise = env.DB.prepare(`
    ${SUPPORT_THREAD_SELECT_SQL}
    WHERE st.status = 'closed'
    ORDER BY st.updated_at DESC, st.id DESC
    LIMIT ?
  `).bind(SUPPORT_DASHBOARD_CLOSED_TICKET_LIMIT).all<PlatformDashboardTicketRow>();
  const supportStatsPromise = includeStats
    ? readPlatformDashboardStats(env)
    : Promise.resolve<PlatformDashboardStatsRow | null>(null);

  const [
    reportsChannel,
    reportsSummary,
    openResultsResponse,
    closedResultsResponse,
    supportStats,
  ] = await Promise.all([
    reportsChannelPromise,
    reportsSummaryPromise,
    openResultsPromise,
    closedResultsPromise,
    supportStatsPromise,
  ]);

  const openResults = openResultsResponse.results;
  const closedResults = closedResultsResponse.results;

  const openRows = openResults || [];
  const hasMoreOpenTickets = openRows.length > openLimit;
  const visibleOpenRows = openRows.slice(0, openLimit);
  const openTickets = visibleOpenRows.map((thread) => ({
    ...serializeThread(thread, locale),
    user_label: formatSupportUserLabel(thread, locale),
    has_admin_reply: !!thread.has_admin_reply,
  }));
  const closedTickets = (closedResults || []).map((thread) => ({
    ...serializeThread(thread, locale),
    user_label: formatSupportUserLabel(thread, locale),
    has_admin_reply: !!thread.has_admin_reply,
  }));
  const tickets = [...openTickets, ...closedTickets];
  const lastOpenRow = visibleOpenRows.at(-1);

  return Response.json({
    reportsInbox: reportsChannel ? {
      channel_id: reportsChannel.id,
      name: reportsChannel.name,
      profile_image: reportsChannel.profile_image,
      bubble_color: reportsChannel.bubble_color || "#111827",
      open_report_count: Number(reportsSummary?.open_report_count || 0),
      oldest_report_at: reportsSummary?.oldest_report_at || null,
      created_at: reportsChannel.created_at,
    } : null,
    tickets,
    open_pagination: {
      has_more: hasMoreOpenTickets,
      next_cursor: hasMoreOpenTickets && lastOpenRow ? `${lastOpenRow.updated_at}|${lastOpenRow.id}` : null,
    },
    support_stats: includeStats ? serializePlatformDashboardStats(supportStats) : undefined,
  });
}

async function fetchPlatformDashboardStats(env: Env): Promise<Response> {
  return Response.json({
    support_stats: serializePlatformDashboardStats(await readPlatformDashboardStats(env)),
  });
}

async function fetchPlatformDashboardVersion(env: Env): Promise<Response> {
  const [threadVersion, reportVersion] = await Promise.all([
    env.DB.prepare(`
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS active_count,
        MAX(updated_at) AS latest_at
      FROM support_threads
    `).first<PlatformDashboardVersionRow>(),
    env.DB.prepare(`
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS active_count,
        MAX(COALESCE(resolved_at, created_at)) AS latest_at
      FROM channel_reports
    `).first<PlatformDashboardVersionRow>(),
  ]);
  return Response.json({
    version: [
      Number(threadVersion?.total_count || 0),
      Number(threadVersion?.active_count || 0),
      threadVersion?.latest_at || "",
      Number(reportVersion?.total_count || 0),
      Number(reportVersion?.active_count || 0),
      reportVersion?.latest_at || "",
    ].join(":"),
  });
}

async function fetchPlatformSupportThreadDetail(
  threadId: string,
  locale: UserLocale,
  env: Env,
  after?: { createdAt: string; id: string } | null,
): Promise<Response> {
  const [thread, messages] = await Promise.all([
    fetchSupportThreadById(threadId, env),
    fetchSupportMessages(threadId, env, after),
  ]);
  if (!thread) {
    return Response.json({ error: "thread_not_found" }, { status: 404 });
  }
  return Response.json({
    thread: serializeThread(thread, locale),
    messages,
  });
}

async function fetchPlatformSupportSessionDetail(sessionId: string, locale: UserLocale, env: Env): Promise<Response> {
  const [session, transcript] = await Promise.all([
    fetchSupportSessionById(sessionId, env),
    fetchSupportSessionEvents(sessionId, env),
  ]);
  if (!session) {
    return Response.json({ error: "session_not_found" }, { status: 404 });
  }
  const currentNode = getSupportNode(session.current_node_id, locale);
  return Response.json({
    session: serializeSession(session, locale),
    transcript,
    currentNode: serializeNode(currentNode),
  });
}

async function fetchPlatformOperationalHealth(env: Env): Promise<Response> {
  const generatedAt = new Date();
  const cutoff15m = new Date(generatedAt.getTime() - 15 * 60 * 1000).toISOString();
  const cutoff24h = new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const summarySql = `
    SELECT
      COUNT(*) AS tracked_event_count,
      SUM(CASE WHEN event_type = 'request_failed' AND status_code >= 500 THEN 1 ELSE 0 END) AS request_5xx_count,
      SUM(CASE WHEN event_type = 'preview_upstream_failed' THEN 1 ELSE 0 END) AS preview_upstream_failure_count,
      SUM(CASE WHEN event_type = 'unhandled_exception' THEN 1 ELSE 0 END) AS unhandled_exception_count,
      SUM(CASE WHEN event_type = 'maintenance_failed' THEN 1 ELSE 0 END) AS maintenance_failure_count,
      SUM(CASE WHEN event_type = 'cleanup_failed' THEN 1 ELSE 0 END) AS cleanup_failure_count,
      SUM(CASE WHEN event_type = 'realtime_unavailable' THEN 1 ELSE 0 END) AS realtime_failure_count,
      SUM(CASE WHEN event_type = 'rate_limited' THEN 1 ELSE 0 END) AS rate_limited_count,
      SUM(CASE WHEN event_type = 'forbidden' THEN 1 ELSE 0 END) AS forbidden_count,
      SUM(CASE WHEN event_type = 'media_not_found' THEN 1 ELSE 0 END) AS media_not_found_count
    FROM operational_events
    WHERE created_at >= ?
  `;

  const [last15mRow, last24hRow, routeResults, alertState, authMonitoringRow] = await Promise.all([
    env.DB.prepare(summarySql).bind(cutoff15m).first<OperationalHealthWindowRow>(),
    env.DB.prepare(summarySql).bind(cutoff24h).first<OperationalHealthWindowRow>(),
    env.DB.prepare(`
      WITH normalized_events AS (
        SELECT
          CASE
            WHEN route LIKE 'GET /ws/%' THEN 'GET /ws/:channel'
            ELSE route
          END AS normalized_route,
          event_type,
          status_code,
          created_at
        FROM operational_events
        WHERE created_at >= ?
          AND event_type IN ('request_failed', 'preview_upstream_failed', 'unhandled_exception', 'maintenance_failed', 'cleanup_failed', 'realtime_unavailable', 'rate_limited', 'forbidden', 'media_not_found')
      )
      SELECT
        normalized_route AS route,
        SUM(CASE WHEN event_type = 'request_failed' AND status_code >= 500 THEN 1 ELSE 0 END) AS request_5xx_count,
        SUM(CASE WHEN event_type = 'preview_upstream_failed' THEN 1 ELSE 0 END) AS preview_upstream_failure_count,
        SUM(CASE WHEN event_type = 'unhandled_exception' THEN 1 ELSE 0 END) AS unhandled_exception_count,
        SUM(CASE WHEN event_type = 'maintenance_failed' THEN 1 ELSE 0 END) AS maintenance_failure_count,
        SUM(CASE WHEN event_type = 'cleanup_failed' THEN 1 ELSE 0 END) AS cleanup_failure_count,
        SUM(CASE WHEN event_type = 'realtime_unavailable' THEN 1 ELSE 0 END) AS realtime_failure_count,
        SUM(CASE WHEN event_type = 'rate_limited' THEN 1 ELSE 0 END) AS rate_limited_count,
        SUM(CASE WHEN event_type = 'forbidden' THEN 1 ELSE 0 END) AS forbidden_count,
        SUM(CASE WHEN event_type = 'media_not_found' THEN 1 ELSE 0 END) AS media_not_found_count,
        MAX(created_at) AS last_event_at
      FROM normalized_events
      GROUP BY normalized_route
      ORDER BY request_5xx_count DESC, preview_upstream_failure_count DESC, unhandled_exception_count DESC,
               maintenance_failure_count DESC, cleanup_failure_count DESC, realtime_failure_count DESC,
               rate_limited_count DESC, forbidden_count DESC,
               media_not_found_count DESC
      LIMIT 12
    `).bind(cutoff24h).all<OperationalHealthWindowRow & { route: string; last_event_at: string }>(),
    env.DB.prepare(`
      SELECT notified_status, last_alert_kind, last_alert_at
      FROM operational_health_alert_state
      WHERE alert_key = 'core_health'
    `).first<{
      notified_status: "healthy" | "degraded" | "critical";
      last_alert_kind: "degraded" | "critical" | "recovery" | null;
      last_alert_at: string | null;
    }>(),
    env.DB.prepare(`
      SELECT
        SUM(event_type = 'email_verification_sent') AS email_verification_sent_count,
        SUM(event_type = 'email_verification_completed') AS email_verification_completed_count,
        SUM(event_type = 'email_verification_delivery_failed') AS email_verification_delivery_failed_count,
        SUM(event_type = 'password_reset_sent') AS password_reset_sent_count,
        SUM(event_type = 'password_reset_completed') AS password_reset_completed_count,
        SUM(event_type = 'password_reset_delivery_failed') AS password_reset_delivery_failed_count,
        SUM(event_type = 'legacy_password_upgrade_succeeded') AS legacy_password_upgrade_succeeded_count,
        SUM(event_type = 'legacy_password_upgrade_failed') AS legacy_password_upgrade_failed_count,
        (
          SELECT COUNT(*)
          FROM users
          WHERE password_hash IS NOT NULL
            AND password_hash NOT LIKE 'pbkdf2-sha256$%'
        ) AS remaining_legacy_password_count,
        MAX(CASE
          WHEN event_type IN (
            'email_verification_delivery_failed',
            'password_reset_delivery_failed',
            'legacy_password_upgrade_failed'
          )
          THEN created_at
        END) AS last_failure_at
      FROM operational_events
      WHERE created_at >= ?
        AND event_type IN (
          'email_verification_sent',
          'email_verification_completed',
          'email_verification_delivery_failed',
          'password_reset_sent',
          'password_reset_completed',
          'password_reset_delivery_failed',
          'legacy_password_upgrade_succeeded',
          'legacy_password_upgrade_failed'
        )
    `).bind(cutoff24h).first<AuthMonitoringRow>(),
  ]);

  const last15m = serializeOperationalHealthWindow(last15mRow);
  const last24h = serializeOperationalHealthWindow(last24hRow);
  return Response.json({
    generated_at: generatedAt.toISOString(),
    status: deriveOperationalHealthStatus(last15m),
    windows: {
      last_15m: last15m,
      last_24h: last24h,
    },
    thresholds: OPERATIONAL_HEALTH_THRESHOLDS,
    alerting: {
      enabled: isOperationalAlertingEnabled(env),
      evaluation_interval_minutes: 5,
      notified_status: alertState?.notified_status || "healthy",
      last_alert_kind: alertState?.last_alert_kind || null,
      last_alert_at: alertState?.last_alert_at || null,
    },
    auth_monitoring: serializeAuthMonitoringSummary(authMonitoringRow),
    routes: (routeResults.results || []).map((row) => ({
      route: row.route,
      ...serializeOperationalHealthWindow(row),
      last_event_at: row.last_event_at,
    })),
  });
}

async function handlePlatformSupportSendMessage(body: JsonObject, actorUserId: string, env: Env): Promise<Response> {
  const rateLimited = await applySupportRateLimit({
    env,
    scope: "platform-support-message",
    userId: actorUserId,
    limit: SUPPORT_MESSAGE_LIMIT,
  });
  if (rateLimited) return rateLimited;

  const threadId = typeof body.thread_id === "string" ? body.thread_id : "";
  const text = typeof body.text === "string" ? body.text.trim().slice(0, SUPPORT_TEXT_MAX_LENGTH) : "";
  if (!threadId || !text) {
    return Response.json({ error: "missing required fields" }, { status: 400 });
  }
  const thread = await fetchSupportThreadById(threadId, env);
  if (!thread || thread.status !== "open") {
    return Response.json({ error: "thread_not_found" }, { status: 404 });
  }

  const createdAt = new Date().toISOString();
  const messageId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO support_messages (id, thread_id, sender_role, sender_user_id, text, created_at)
      VALUES (?, ?, 'platform_admin', ?, ?, ?)
    `).bind(messageId, threadId, actorUserId, text, createdAt),
    env.DB.prepare(`
      UPDATE support_threads
      SET updated_at = ?
      WHERE id = ?
    `).bind(createdAt, threadId),
  ]);
  await markSupportThreadRead({
    env,
    threadId,
    actorRole: "platform_admin",
    readAt: createdAt,
  });
  await appendSupportAuditLog({
    env,
    threadId,
    actorRole: "platform_admin",
    actorUserId,
    action: "admin_replied",
    detail: {
      text_length: text.length,
    },
  });
  await recordOperationalEvent({
    env,
    severity: "info",
    route: "/api/platform-admin/support",
    eventType: "support_admin_replied",
    actorUserId,
    targetId: threadId,
    detail: {
      textLength: text.length,
    },
  });
  return Response.json({
    ok: true,
    message: {
      id: messageId,
      thread_id: threadId,
      sender_role: "platform_admin",
      sender_user_id: actorUserId,
      text,
      created_at: createdAt,
    },
  });
}

async function handlePlatformSupportCloseThread(body: JsonObject, actorUserId: string, env: Env): Promise<Response> {
  const threadId = typeof body.thread_id === "string" ? body.thread_id : "";
  if (!threadId) {
    return Response.json({ error: "missing thread_id" }, { status: 400 });
  }
  return closeSupportThreadRecord(threadId, actorUserId, "platform_admin", env);
}

async function handlePlatformSupportMarkThreadRead(body: JsonObject, env: Env): Promise<Response> {
  const threadId = typeof body.thread_id === "string" ? body.thread_id : "";
  if (!threadId) {
    return Response.json({ error: "missing thread_id" }, { status: 400 });
  }
  const thread = await fetchSupportThreadById(threadId, env);
  if (!thread) {
    return Response.json({ error: "thread_not_found" }, { status: 404 });
  }
  await markSupportThreadRead({
    env,
    threadId,
    actorRole: "platform_admin",
  });
  return Response.json({ ok: true });
}

export async function handlePlatformSupport(request: Request, env: Env): Promise<Response> {
  const actorUserId = await requirePlatformAdminUserId(request, env);
  if (!actorUserId) {
    return Response.json({ error: "owner access required" }, { status: 403 });
  }
  if (request.method === "GET") {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "dashboard";
    if (type === "dashboard-version") {
      return fetchPlatformDashboardVersion(env);
    }
    if (type === "dashboard-stats") {
      return fetchPlatformDashboardStats(env);
    }
    if (type === "health") {
      return fetchPlatformOperationalHealth(env);
    }
    const locale = await getUserLocale(actorUserId, env);
    if (type === "dashboard") {
      return fetchPlatformSupportDashboard(url, locale, env);
    }
    if (type === "thread") {
      const threadId = url.searchParams.get("thread_id") || "";
      const afterCreatedAt = url.searchParams.get("after_created_at") || "";
      const afterId = url.searchParams.get("after_id") || "";
      if (
        afterCreatedAt.length > 64
        || afterId.length > 100
        || (afterCreatedAt && !Number.isFinite(Date.parse(afterCreatedAt)))
      ) {
        return Response.json({ error: "invalid_message_cursor" }, { status: 400 });
      }
      const after = afterCreatedAt && afterId
        ? { createdAt: afterCreatedAt, id: afterId }
        : null;
      return fetchPlatformSupportThreadDetail(threadId, locale, env, after);
    }
    if (type === "session") {
      const sessionId = url.searchParams.get("session_id") || "";
      return fetchPlatformSupportSessionDetail(sessionId, locale, env);
    }
    return Response.json({ error: "invalid_type" }, { status: 400 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const body = await parseJsonObject(request);
  if (!body) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  if (action === "send_message") {
    return handlePlatformSupportSendMessage(body, actorUserId, env);
  }
  if (action === "close_thread") {
    return handlePlatformSupportCloseThread(body, actorUserId, env);
  }
  if (action === "mark_thread_read") {
    return handlePlatformSupportMarkThreadRead(body, env);
  }
  return Response.json({ error: "invalid_action" }, { status: 400 });
}
