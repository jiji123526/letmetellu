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

function canMeasure() {
  return typeof performance !== "undefined" && typeof performance.mark === "function";
}

function hasEntry(name: string, type: "mark" | "measure") {
  return performance.getEntriesByName(name, type).length > 0;
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
}

export function markDashboardMilestone(milestone: DashboardMilestone) {
  if (!canMeasure()) return;
  const startName = `${PREFIX}:start`;
  const markName = `${PREFIX}:${milestone}`;
  const measureName = `${PREFIX}:time-to-${milestone}`;
  if (!hasEntry(startName, "mark") || hasEntry(markName, "mark")) return;
  performance.mark(markName);
  performance.measure(measureName, startName, markName);
}

export function startDashboardRequest(request: DashboardRequest) {
  if (!canMeasure()) return;
  const markName = `${PREFIX}:${request}:start`;
  if (!hasEntry(markName, "mark")) {
    performance.mark(markName);
  }
}

export function finishDashboardRequest(request: DashboardRequest) {
  if (!canMeasure()) return;
  const startName = `${PREFIX}:${request}:start`;
  const endName = `${PREFIX}:${request}:end`;
  const measureName = `${PREFIX}:${request}:duration`;
  if (!hasEntry(startName, "mark") || hasEntry(endName, "mark")) return;
  performance.mark(endName);
  performance.measure(measureName, startName, endName);
}
