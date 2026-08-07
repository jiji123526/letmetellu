const PREFIX = "letmetellu:dashboard";

const DASHBOARD_MILESTONES = [
  "session-ready",
  "cached-channels-ready",
  "channels-ready",
  "recent-channels-ready",
  "admin-dashboard-ready",
  "support-preview-ready",
  "usable",
] as const;

const DASHBOARD_REQUESTS = [
  "user-bootstrap",
  "recent-channels",
  "admin-dashboard",
  "support-preview",
] as const;

type DashboardMilestone = (typeof DASHBOARD_MILESTONES)[number];
type DashboardRequest = (typeof DASHBOARD_REQUESTS)[number];

interface DashboardPerformanceSnapshot {
  startedAt: number;
  milestonesMs: Partial<Record<DashboardMilestone, number>>;
  requestCounts: Record<DashboardRequest, number>;
  requestDurationsMs: Record<DashboardRequest, number[]>;
}

interface DashboardPerformanceState extends DashboardPerformanceSnapshot {
  activeRequests: Partial<Record<DashboardRequest, { startedAt: number; sequence: number }>>;
}

declare global {
  interface Window {
    __letmetelluDashboardPerf?: DashboardPerformanceSnapshot;
  }
}

let dashboardState: DashboardPerformanceState | null = null;

function canMeasure() {
  return typeof performance !== "undefined" && typeof performance.mark === "function";
}

function hasEntry(name: string, type: "mark" | "measure") {
  return performance.getEntriesByName(name, type).length > 0;
}

function createEmptyRequestCounts(): Record<DashboardRequest, number> {
  return {
    "user-bootstrap": 0,
    "recent-channels": 0,
    "admin-dashboard": 0,
    "support-preview": 0,
  };
}

function createEmptyRequestDurations(): Record<DashboardRequest, number[]> {
  return {
    "user-bootstrap": [],
    "recent-channels": [],
    "admin-dashboard": [],
    "support-preview": [],
  };
}

function publishDashboardSnapshot() {
  if (typeof window === "undefined" || !dashboardState) return;
  window.__letmetelluDashboardPerf = {
    startedAt: dashboardState.startedAt,
    milestonesMs: dashboardState.milestonesMs,
    requestCounts: dashboardState.requestCounts,
    requestDurationsMs: dashboardState.requestDurationsMs,
  };
}

export function startDashboardPerformanceTrace() {
  if (!canMeasure()) return;
  performance.clearMarks(`${PREFIX}:start`);
  DASHBOARD_MILESTONES.forEach((milestone) => {
    performance.clearMarks(`${PREFIX}:${milestone}`);
    performance.clearMeasures(`${PREFIX}:time-to-${milestone}`);
  });
  DASHBOARD_REQUESTS.forEach((request) => {
    performance.clearMarks(`${PREFIX}:${request}:start`);
    performance.clearMarks(`${PREFIX}:${request}:end`);
    performance.clearMeasures(`${PREFIX}:${request}:duration`);
  });
  performance.mark(`${PREFIX}:start`);
  dashboardState = {
    startedAt: performance.now(),
    milestonesMs: {},
    requestCounts: createEmptyRequestCounts(),
    requestDurationsMs: createEmptyRequestDurations(),
    activeRequests: {},
  };
  publishDashboardSnapshot();
}

export function markDashboardMilestone(milestone: DashboardMilestone) {
  if (!canMeasure()) return;
  const startName = `${PREFIX}:start`;
  const markName = `${PREFIX}:${milestone}`;
  const measureName = `${PREFIX}:time-to-${milestone}`;
  if (!hasEntry(startName, "mark") || hasEntry(markName, "mark")) return;
  performance.mark(markName);
  performance.measure(measureName, startName, markName);
  if (dashboardState) {
    dashboardState.milestonesMs[milestone] = performance.now() - dashboardState.startedAt;
    publishDashboardSnapshot();
  }
}

export function startDashboardRequest(request: DashboardRequest) {
  if (!canMeasure()) return;
  if (!dashboardState) return;
  const sequence = dashboardState.requestCounts[request] + 1;
  dashboardState.requestCounts[request] = sequence;
  dashboardState.activeRequests[request] = {
    startedAt: performance.now(),
    sequence,
  };
  performance.mark(`${PREFIX}:${request}:${sequence}:start`);
  publishDashboardSnapshot();
}

export function finishDashboardRequest(request: DashboardRequest) {
  if (!canMeasure()) return;
  if (!dashboardState) return;
  const activeRequest = dashboardState.activeRequests[request];
  if (!activeRequest) return;
  const startName = `${PREFIX}:${request}:${activeRequest.sequence}:start`;
  const endName = `${PREFIX}:${request}:${activeRequest.sequence}:end`;
  const measureName = `${PREFIX}:${request}:${activeRequest.sequence}:duration`;
  performance.mark(endName);
  performance.measure(measureName, startName, endName);
  dashboardState.requestDurationsMs[request].push(performance.now() - activeRequest.startedAt);
  delete dashboardState.activeRequests[request];
  publishDashboardSnapshot();
}
