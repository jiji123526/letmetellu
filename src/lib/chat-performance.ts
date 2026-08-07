const PREFIX = "letmetellu:chat";
const MAX_CYCLES_PER_CHANNEL = 12;

type ChatPerformanceRequest = "init" | "messages" | "ws-token";
type ChatPerformanceCycleKind = "bootstrap" | "reconnect" | "visibility-resume";
type ChatPerformanceOutcome = "pending" | "settled" | "failed" | "passcode-gated";

interface ChatPerformanceMetadata {
  [key: string]: boolean | number | string | null;
}

interface ChatPerformanceCycleSnapshot {
  id: string;
  kind: ChatPerformanceCycleKind;
  startedAt: number;
  completedAtMs: number | null;
  socketSynchronizedAtMs: number | null;
  reconnectAttempts: number;
  outcome: ChatPerformanceOutcome;
  metadata: ChatPerformanceMetadata;
  requestCounts: Record<ChatPerformanceRequest, number>;
  requestDurationsMs: Record<ChatPerformanceRequest, number[]>;
}

interface ChatPerformanceCycleState extends ChatPerformanceCycleSnapshot {
  activeRequests: Partial<Record<ChatPerformanceRequest, { sequence: number; startedAt: number }>>;
}

declare global {
  interface Window {
    __letmetelluChatPerf?: Record<string, { latestCycleId: string | null; cycles: ChatPerformanceCycleSnapshot[] }>;
  }
}

const channelStates = new Map<string, {
  latestCycleId: string | null;
  cycles: ChatPerformanceCycleState[];
}>();

function now() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function canMeasure() {
  return typeof performance !== "undefined" && typeof performance.mark === "function";
}

function createEmptyRequestCounts(): Record<ChatPerformanceRequest, number> {
  return {
    init: 0,
    messages: 0,
    "ws-token": 0,
  };
}

function createEmptyRequestDurations(): Record<ChatPerformanceRequest, number[]> {
  return {
    init: [],
    messages: [],
    "ws-token": [],
  };
}

function createCycleId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getChannelState(channelId: string) {
  let state = channelStates.get(channelId);
  if (!state) {
    state = {
      latestCycleId: null,
      cycles: [],
    };
    channelStates.set(channelId, state);
  }
  return state;
}

function getCycleState(channelId: string, cycleId: string) {
  const state = getChannelState(channelId);
  return state.cycles.find((cycle) => cycle.id === cycleId) || null;
}

function publishChannelSnapshot(channelId: string) {
  if (typeof window === "undefined") return;
  const state = getChannelState(channelId);
  const cycles = state.cycles.map((cycle) => ({
    id: cycle.id,
    kind: cycle.kind,
    startedAt: cycle.startedAt,
    completedAtMs: cycle.completedAtMs,
    socketSynchronizedAtMs: cycle.socketSynchronizedAtMs,
    reconnectAttempts: cycle.reconnectAttempts,
    outcome: cycle.outcome,
    metadata: cycle.metadata,
    requestCounts: cycle.requestCounts,
    requestDurationsMs: cycle.requestDurationsMs,
  }));
  window.__letmetelluChatPerf = {
    ...(window.__letmetelluChatPerf || {}),
    [channelId]: {
      latestCycleId: state.latestCycleId,
      cycles,
    },
  };
}

export function startChatPerformanceCycle(
  channelId: string,
  kind: ChatPerformanceCycleKind,
  metadata: ChatPerformanceMetadata = {},
) {
  const state = getChannelState(channelId);
  const cycleId = createCycleId();
  const cycle: ChatPerformanceCycleState = {
    id: cycleId,
    kind,
    startedAt: now(),
    completedAtMs: null,
    socketSynchronizedAtMs: null,
    reconnectAttempts: 0,
    outcome: "pending",
    metadata,
    requestCounts: createEmptyRequestCounts(),
    requestDurationsMs: createEmptyRequestDurations(),
    activeRequests: {},
  };
  state.latestCycleId = cycleId;
  state.cycles.push(cycle);
  if (state.cycles.length > MAX_CYCLES_PER_CHANNEL) {
    state.cycles.splice(0, state.cycles.length - MAX_CYCLES_PER_CHANNEL);
  }
  if (canMeasure()) {
    performance.mark(`${PREFIX}:${channelId}:${cycleId}:start`);
  }
  publishChannelSnapshot(channelId);
  return cycleId;
}

export function incrementChatReconnectAttempt(channelId: string, cycleId: string) {
  const cycle = getCycleState(channelId, cycleId);
  if (!cycle) return;
  cycle.reconnectAttempts += 1;
  publishChannelSnapshot(channelId);
}

export function startChatPerformanceRequest(
  channelId: string,
  cycleId: string,
  request: ChatPerformanceRequest,
) {
  const cycle = getCycleState(channelId, cycleId);
  if (!cycle) return;
  const sequence = cycle.requestCounts[request] + 1;
  cycle.requestCounts[request] = sequence;
  cycle.activeRequests[request] = {
    sequence,
    startedAt: now(),
  };
  if (canMeasure()) {
    performance.mark(`${PREFIX}:${channelId}:${cycleId}:${request}:${sequence}:start`);
  }
  publishChannelSnapshot(channelId);
}

export function finishChatPerformanceRequest(
  channelId: string,
  cycleId: string,
  request: ChatPerformanceRequest,
) {
  const cycle = getCycleState(channelId, cycleId);
  const activeRequest = cycle?.activeRequests[request];
  if (!cycle || !activeRequest) return;
  if (canMeasure()) {
    const startName = `${PREFIX}:${channelId}:${cycleId}:${request}:${activeRequest.sequence}:start`;
    const endName = `${PREFIX}:${channelId}:${cycleId}:${request}:${activeRequest.sequence}:end`;
    performance.mark(endName);
    performance.measure(
      `${PREFIX}:${channelId}:${cycleId}:${request}:${activeRequest.sequence}:duration`,
      startName,
      endName,
    );
  }
  cycle.requestDurationsMs[request].push(now() - activeRequest.startedAt);
  delete cycle.activeRequests[request];
  publishChannelSnapshot(channelId);
}

export function markChatSocketSynchronized(channelId: string, cycleId: string) {
  const cycle = getCycleState(channelId, cycleId);
  if (!cycle || cycle.socketSynchronizedAtMs !== null) return;
  cycle.socketSynchronizedAtMs = now() - cycle.startedAt;
  if (canMeasure()) {
    const markName = `${PREFIX}:${channelId}:${cycleId}:socket-synchronized`;
    performance.mark(markName);
    performance.measure(
      `${PREFIX}:${channelId}:${cycleId}:time-to-socket-synchronized`,
      `${PREFIX}:${channelId}:${cycleId}:start`,
      markName,
    );
  }
  publishChannelSnapshot(channelId);
}

export function completeChatPerformanceCycle(
  channelId: string,
  cycleId: string,
  outcome: Exclude<ChatPerformanceOutcome, "pending">,
) {
  const cycle = getCycleState(channelId, cycleId);
  if (!cycle || cycle.completedAtMs !== null) return;
  cycle.outcome = outcome;
  cycle.completedAtMs = now() - cycle.startedAt;
  if (canMeasure()) {
    const markName = `${PREFIX}:${channelId}:${cycleId}:complete`;
    performance.mark(markName);
    performance.measure(
      `${PREFIX}:${channelId}:${cycleId}:time-to-complete`,
      `${PREFIX}:${channelId}:${cycleId}:start`,
      markName,
    );
  }
  publishChannelSnapshot(channelId);
}
