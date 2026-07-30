import type { Env } from "../types";
import { getUserLocale, type UserLocale } from "../lib/channel-moderation";
import { isReportsChannelOwner } from "../lib/special-channels";
import { buildSupportFlow, buildSupportSummary, getSupportNode, supportTopicLabel, type SupportNode, type SupportTranscriptEvent } from "../lib/support-flow";
import { consumeDurableRateLimit } from "../lib/durable-rate-limit";

const SUPPORT_TEXT_MAX_LENGTH = 1_500;
const SUPPORT_SESSION_TEXT_MAX_LENGTH = 500;
const SUPPORT_RATE_LIMIT_WINDOW_MS = 30_000;
const SUPPORT_START_LIMIT = 3;
const SUPPORT_ANSWER_LIMIT = 12;
const SUPPORT_MESSAGE_LIMIT = 8;

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
  user_name?: string | null;
  user_email?: string | null;
  last_message?: string | null;
}

interface SupportMessageRow {
  id: string;
  thread_id: string;
  sender_role: "user" | "platform_admin";
  sender_user_id: string | null;
  text: string;
  created_at: string;
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

function serializeThread(row: SupportThreadRow, locale: UserLocale) {
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
    user_name: row.user_name || null,
    user_email: row.user_email || null,
    last_message: row.last_message || null,
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
  const token = request.headers.get("X-Internal-Token");
  const userId = request.headers.get("X-User-Id");
  if (token !== env.INTERNAL_SECRET || !userId) return null;
  return userId;
}

async function requirePlatformAdminUserId(request: Request, env: Env): Promise<string | null> {
  const userId = await requireTrustedUserId(request, env);
  if (!userId) return null;
  return await isReportsChannelOwner(userId, env) ? userId : null;
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
      (
        SELECT text
        FROM support_messages sm
        WHERE sm.thread_id = st.id
        ORDER BY sm.created_at DESC, sm.id DESC
        LIMIT 1
      ) AS last_message
    FROM support_threads st
    WHERE st.user_id = ? AND st.status = 'open'
    ORDER BY st.updated_at DESC, st.id DESC
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
      u.name AS user_name,
      u.email AS user_email,
      (
        SELECT text
        FROM support_messages sm
        WHERE sm.thread_id = st.id
        ORDER BY sm.created_at DESC, sm.id DESC
        LIMIT 1
      ) AS last_message
    FROM support_threads st
    LEFT JOIN users u ON u.id = st.user_id
    WHERE st.id = ?
    LIMIT 1
  `).bind(threadId).first<SupportThreadRow>();
}

async function fetchSupportSessionEvents(sessionId: string, env: Env): Promise<SupportTranscriptEvent[]> {
  const { results } = await env.DB.prepare(`
    SELECT id, session_id, event_type, node_id, payload_json, created_at
    FROM support_session_events
    WHERE session_id = ?
    ORDER BY created_at ASC, id ASC
  `).bind(sessionId).all<SupportSessionEventRow>();
  return (results || []).map(parseEventPayload);
}

async function fetchSupportMessages(threadId: string, env: Env): Promise<SupportMessageRow[]> {
  const { results } = await env.DB.prepare(`
    SELECT id, thread_id, sender_role, sender_user_id, text, created_at
    FROM support_messages
    WHERE thread_id = ?
    ORDER BY created_at ASC, id ASC
  `).bind(threadId).all<SupportMessageRow>();
  return results || [];
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

async function buildUserSupportState(userId: string, env: Env): Promise<Response> {
  const locale = await getUserLocale(userId, env);
  const platformAdmin = await isReportsChannelOwner(userId, env);
  const openThread = await fetchOpenSupportThreadForUser(userId, env);
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

  const openSession = await fetchOpenSupportSessionForUser(userId, env);
  if (!openSession) {
    return Response.json({
      platformAdmin,
      thread: null,
      messages: [],
      session: null,
      transcript: [],
      currentNode: null,
    });
  }

  const transcript = await fetchSupportSessionEvents(openSession.id, env);
  const currentNode = getSupportNode(openSession.current_node_id, locale);
  return Response.json({
    platformAdmin,
    thread: null,
    messages: [],
    session: serializeSession(openSession, locale),
    transcript,
    currentNode: serializeNode(currentNode),
  });
}

function getNextTextNodeId(currentNodeId: string): string {
  if (currentNodeId.endsWith("-details")) {
    return currentNodeId.replace(/-details$/, "-escalate");
  }
  return "resolved";
}

async function handleSupportStartSession(userId: string, env: Env): Promise<Response> {
  const rateLimited = await applySupportRateLimit({
    env,
    scope: "support-session-start",
    userId,
    limit: SUPPORT_START_LIMIT,
  });
  if (rateLimited) return rateLimited;

  const locale = await getUserLocale(userId, env);
  const existingThread = await fetchOpenSupportThreadForUser(userId, env);
  if (existingThread) {
    const messages = await fetchSupportMessages(existingThread.id, env);
    return Response.json({
      thread: serializeThread(existingThread, locale),
      messages,
      session: null,
      transcript: [],
      currentNode: null,
    });
  }

  const existingSession = await fetchOpenSupportSessionForUser(userId, env);
  if (existingSession) {
    const transcript = await fetchSupportSessionEvents(existingSession.id, env);
    return Response.json({
      thread: null,
      messages: [],
      session: serializeSession(existingSession, locale),
      transcript,
      currentNode: serializeNode(getSupportNode(existingSession.current_node_id, locale)),
    });
  }

  const sessionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO support_sessions (
      id, user_id, status, current_node_id, created_at, updated_at
    ) VALUES (?, ?, 'open', 'start', ?, ?)
  `).bind(sessionId, userId, createdAt, createdAt).run();
  await insertBotMessages({
    env,
    sessionId,
    nodeId: "start",
    createdAt,
    messages: buildSupportFlow(locale).start.messages,
  });

  const session = await fetchSupportSessionById(sessionId, env);
  const transcript = await fetchSupportSessionEvents(sessionId, env);
  return Response.json({
    thread: null,
    messages: [],
    session: session ? serializeSession(session, locale) : null,
    transcript,
    currentNode: serializeNode(getSupportNode("start", locale)),
  });
}

async function handleSupportAnswerSession(body: JsonObject, userId: string, env: Env): Promise<Response> {
  const rateLimited = await applySupportRateLimit({
    env,
    scope: "support-session-answer",
    userId,
    limit: SUPPORT_ANSWER_LIMIT,
  });
  if (rateLimited) return rateLimited;

  const locale = await getUserLocale(userId, env);
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!sessionId) {
    return Response.json({ error: "missing session_id" }, { status: 400 });
  }

  const session = await fetchSupportSessionById(sessionId, env);
  if (!session || session.user_id !== userId || session.status !== "open") {
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
    nextEntryTopic = nextEntryTopic || choice.topic || null;
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

  const updatedSession = await fetchSupportSessionById(session.id, env);
  const transcript = await fetchSupportSessionEvents(session.id, env);
  return Response.json({
    thread: null,
    messages: [],
    session: updatedSession ? serializeSession(updatedSession, locale) : null,
    transcript,
    currentNode: serializeNode(nextNode),
  });
}

async function handleSupportEscalateSession(body: JsonObject, userId: string, env: Env): Promise<Response> {
  const rateLimited = await applySupportRateLimit({
    env,
    scope: "support-session-escalate",
    userId,
    limit: SUPPORT_START_LIMIT,
  });
  if (rateLimited) return rateLimited;

  const locale = await getUserLocale(userId, env);
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!sessionId) {
    return Response.json({ error: "missing session_id" }, { status: 400 });
  }

  const session = await fetchSupportSessionById(sessionId, env);
  if (!session || session.user_id !== userId || session.status !== "open") {
    return Response.json({ error: "session_not_found" }, { status: 404 });
  }
  const currentNode = getSupportNode(session.current_node_id, locale);
  if (!currentNode || currentNode.kind !== "escalate") {
    return Response.json({ error: "invalid_state" }, { status: 409 });
  }

  const existingThread = await fetchOpenSupportThreadForUser(userId, env);
  if (existingThread) {
    const messages = await fetchSupportMessages(existingThread.id, env);
    return Response.json({
      thread: serializeThread(existingThread, locale),
      messages,
    });
  }

  const transcript = await fetchSupportSessionEvents(session.id, env);
  const summary = buildSupportSummary({
    locale,
    topic: session.entry_topic,
    events: transcript,
  });
  const threadId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO support_threads (
        id, user_id, source_session_id, entry_topic, summary, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
    `).bind(threadId, userId, session.id, session.entry_topic, summary, createdAt, createdAt),
    env.DB.prepare(`
      INSERT INTO support_messages (id, thread_id, sender_role, sender_user_id, text, created_at)
      VALUES (?, ?, 'user', ?, ?, ?)
    `).bind(messageId, threadId, userId, summary, createdAt),
    env.DB.prepare(`
      INSERT INTO support_session_events (id, session_id, event_type, node_id, payload_json, created_at)
      VALUES (?, ?, 'escalation', ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      session.id,
      currentNode.id,
      JSON.stringify({ thread_id: threadId, summary }),
      createdAt,
    ),
    env.DB.prepare(`
      UPDATE support_sessions
      SET status = 'escalated', escalated_thread_id = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).bind(threadId, createdAt, createdAt, session.id),
  ]);

  const thread = await fetchSupportThreadById(threadId, env);
  const messages = await fetchSupportMessages(threadId, env);
  return Response.json({
    thread: thread ? serializeThread(thread, locale) : null,
    messages,
  });
}

async function handleUserSupportThreadMessage(body: JsonObject, userId: string, env: Env): Promise<Response> {
  const rateLimited = await applySupportRateLimit({
    env,
    scope: "support-thread-message",
    userId,
    limit: SUPPORT_MESSAGE_LIMIT,
  });
  if (rateLimited) return rateLimited;

  const threadId = typeof body.thread_id === "string" ? body.thread_id : "";
  const text = typeof body.text === "string" ? body.text.trim().slice(0, SUPPORT_TEXT_MAX_LENGTH) : "";
  if (!threadId || !text) {
    return Response.json({ error: "missing required fields" }, { status: 400 });
  }

  const thread = await fetchSupportThreadById(threadId, env);
  if (!thread || thread.user_id !== userId || thread.status !== "open") {
    return Response.json({ error: "thread_not_found" }, { status: 404 });
  }

  const createdAt = new Date().toISOString();
  const messageId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO support_messages (id, thread_id, sender_role, sender_user_id, text, created_at)
      VALUES (?, ?, 'user', ?, ?, ?)
    `).bind(messageId, threadId, userId, text, createdAt),
    env.DB.prepare(`
      UPDATE support_threads
      SET updated_at = ?
      WHERE id = ?
    `).bind(createdAt, threadId),
  ]);
  return Response.json({
    ok: true,
    message: {
      id: messageId,
      thread_id: threadId,
      sender_role: "user",
      sender_user_id: userId,
      text,
      created_at: createdAt,
    },
  });
}

export async function handleSupport(request: Request, env: Env): Promise<Response> {
  const userId = await requireTrustedUserId(request, env);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (request.method === "GET") {
    return buildUserSupportState(userId, env);
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
    return handleSupportStartSession(userId, env);
  }
  if (action === "answer_session") {
    return handleSupportAnswerSession(body, userId, env);
  }
  if (action === "escalate_session") {
    return handleSupportEscalateSession(body, userId, env);
  }
  if (action === "send_thread_message") {
    return handleUserSupportThreadMessage(body, userId, env);
  }
  return Response.json({ error: "invalid_action" }, { status: 400 });
}

async function fetchPlatformSupportThreads(locale: UserLocale, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`
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
      u.name AS user_name,
      u.email AS user_email,
      (
        SELECT text
        FROM support_messages sm
        WHERE sm.thread_id = st.id
        ORDER BY sm.created_at DESC, sm.id DESC
        LIMIT 1
      ) AS last_message
    FROM support_threads st
    LEFT JOIN users u ON u.id = st.user_id
    WHERE st.status = 'open'
    ORDER BY st.updated_at DESC, st.id DESC
  `).all<SupportThreadRow>();
  return Response.json({
    threads: (results || []).map((thread) => serializeThread(thread, locale)),
  });
}

async function fetchPlatformSupportThreadDetail(threadId: string, locale: UserLocale, env: Env): Promise<Response> {
  const thread = await fetchSupportThreadById(threadId, env);
  if (!thread) {
    return Response.json({ error: "thread_not_found" }, { status: 404 });
  }
  const messages = await fetchSupportMessages(threadId, env);
  return Response.json({
    thread: serializeThread(thread, locale),
    messages,
  });
}

async function fetchPlatformSupportSessionDetail(sessionId: string, locale: UserLocale, env: Env): Promise<Response> {
  const session = await fetchSupportSessionById(sessionId, env);
  if (!session) {
    return Response.json({ error: "session_not_found" }, { status: 404 });
  }
  const transcript = await fetchSupportSessionEvents(sessionId, env);
  const currentNode = getSupportNode(session.current_node_id, locale);
  return Response.json({
    session: serializeSession(session, locale),
    transcript,
    currentNode: serializeNode(currentNode),
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
  const thread = await fetchSupportThreadById(threadId, env);
  if (!thread || thread.status !== "open") {
    return Response.json({ error: "thread_not_found" }, { status: 404 });
  }
  const closedAt = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE support_threads
    SET status = 'closed', updated_at = ?, closed_at = ?, closed_by = ?
    WHERE id = ?
  `).bind(closedAt, closedAt, actorUserId, threadId).run();
  return Response.json({ ok: true });
}

export async function handlePlatformSupport(request: Request, env: Env): Promise<Response> {
  const actorUserId = await requirePlatformAdminUserId(request, env);
  if (!actorUserId) {
    return Response.json({ error: "owner access required" }, { status: 403 });
  }
  const locale = await getUserLocale(actorUserId, env);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "threads";
    if (type === "threads") {
      return fetchPlatformSupportThreads(locale, env);
    }
    if (type === "thread") {
      const threadId = url.searchParams.get("thread_id") || "";
      return fetchPlatformSupportThreadDetail(threadId, locale, env);
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
  return Response.json({ error: "invalid_action" }, { status: 400 });
}
