import type { Env } from "../types";
import {
  deriveOperationalHealthStatus,
  serializeOperationalHealthWindow,
  type OperationalHealthStatus,
  type OperationalHealthWindow,
  type OperationalHealthWindowRow,
} from "./operational-health.ts";

const ALERT_KEY = "core_health";
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ALERT_FROM = "yap. alerts <noreply@send.yapndot.com>";
const RUNBOOK_URL = "https://github.com/jiji123526/letmetellu/blob/main/OPERATIONS_RUNBOOK.md";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const WINDOW_SUMMARY_SQL = `
  SELECT
    COUNT(*) AS tracked_event_count,
    SUM(CASE WHEN event_type = 'request_failed' AND status_code >= 500 THEN 1 ELSE 0 END) AS request_5xx_count,
    SUM(CASE WHEN event_type = 'preview_upstream_failed' THEN 1 ELSE 0 END) AS preview_upstream_failure_count,
    SUM(CASE WHEN event_type = 'unhandled_exception' THEN 1 ELSE 0 END) AS unhandled_exception_count,
    SUM(CASE WHEN event_type = 'd1_unavailable' THEN 1 ELSE 0 END) AS d1_unavailable_count,
    SUM(CASE WHEN event_type = 'maintenance_failed' THEN 1 ELSE 0 END) AS maintenance_failure_count,
    SUM(CASE WHEN event_type = 'cleanup_failed' THEN 1 ELSE 0 END) AS cleanup_failure_count,
    SUM(CASE WHEN event_type = 'realtime_unavailable' THEN 1 ELSE 0 END) AS realtime_failure_count,
    SUM(CASE WHEN event_type = 'rate_limited' THEN 1 ELSE 0 END) AS rate_limited_count,
    SUM(CASE WHEN event_type = 'forbidden' THEN 1 ELSE 0 END) AS forbidden_count,
    SUM(CASE WHEN event_type = 'media_not_found' THEN 1 ELSE 0 END) AS media_not_found_count
  FROM operational_events
  WHERE created_at >= ? AND created_at < ?
`;

interface OperationalAlertStateRow {
  notified_status: OperationalHealthStatus;
  updated_at: string;
}

interface RouteSummaryRow {
  route: string;
  events: number | string;
}

export type OperationalAlertKind = "degraded" | "critical" | "recovery";

export interface OperationalAlertDecision {
  kind: OperationalAlertKind;
  nextNotifiedStatus: OperationalHealthStatus;
}

export function getOperationalAlertDecision(
  current: OperationalHealthStatus,
  previous: OperationalHealthStatus,
  notified: OperationalHealthStatus,
): OperationalAlertDecision | null {
  if (current === "critical" && notified !== "critical") {
    return { kind: "critical", nextNotifiedStatus: "critical" };
  }

  if (current === "degraded" && previous !== "healthy" && notified === "healthy") {
    return { kind: "degraded", nextNotifiedStatus: "degraded" };
  }

  if (current === "healthy" && previous === "healthy" && notified !== "healthy") {
    return { kind: "recovery", nextNotifiedStatus: "healthy" };
  }

  return null;
}

function parseAlertEmail(value: string | undefined): string | null {
  const email = value?.trim().toLowerCase() || "";
  return EMAIL_PATTERN.test(email) && email.length <= 254 ? email : null;
}

export function isOperationalAlertingEnabled(env: Env): boolean {
  return parseAlertEmail(env.OPERATIONAL_ALERT_EMAIL) !== null;
}

function formatWindow(window: OperationalHealthWindow): string {
  return [
    `5xx=${window.request_5xx_count}`,
    `exceptions=${window.unhandled_exception_count}`,
    `d1=${window.d1_unavailable_count}`,
    `maintenance=${window.maintenance_failure_count}`,
    `cleanup=${window.cleanup_failure_count}`,
    `realtime=${window.realtime_failure_count}`,
    `rate_limited=${window.rate_limited_count}`,
  ].join(", ");
}

function dashboardUrl(env: Env): string {
  try {
    return new URL("/dashboard", env.APP_ORIGIN).toString();
  } catch {
    return env.APP_ORIGIN;
  }
}

async function sendOperationalAlertEmail(input: {
  env: Env;
  recipient: string;
  decision: OperationalAlertDecision;
  currentStatus: OperationalHealthStatus;
  previousStatus: OperationalHealthStatus;
  currentWindow: OperationalHealthWindow;
  previousWindow: OperationalHealthWindow;
  routes: RouteSummaryRow[];
  generatedAt: string;
  idempotencyKey: string;
}): Promise<void> {
  const label = input.decision.kind === "recovery"
    ? "RECOVERED"
    : input.decision.kind.toUpperCase();
  const routeText = input.routes.length > 0
    ? input.routes.map((row) => `- ${row.route}: ${Number(row.events) || 0}`).join("\n")
    : "- No severity-triggering route events in the last 30 minutes";
  const text = [
    `Production health: ${label}`,
    `Observed at: ${input.generatedAt}`,
    `Current window: ${input.currentStatus} (${formatWindow(input.currentWindow)})`,
    `Previous window: ${input.previousStatus} (${formatWindow(input.previousWindow)})`,
    "",
    "Dominant routes (last 30 minutes):",
    routeText,
    "",
    `Dashboard: ${dashboardUrl(input.env)}`,
    `Runbook: ${RUNBOOK_URL}`,
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${input.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from: ALERT_FROM,
      to: [input.recipient],
      subject: `[yap. ${input.decision.kind}] Production health ${label.toLowerCase()}`,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`operational alert delivery failed (${response.status}): ${detail.slice(0, 200)}`);
  }
}

export async function runOperationalHealthAlerts(
  env: Env,
  nowMs = Date.now(),
): Promise<{ status: "disabled" | "unchanged" | "delivered"; kind?: OperationalAlertKind }> {
  const recipient = parseAlertEmail(env.OPERATIONAL_ALERT_EMAIL);
  if (!recipient) {
    return { status: "disabled" };
  }

  const currentEnd = new Date(nowMs).toISOString();
  const currentStart = new Date(nowMs - FIFTEEN_MINUTES_MS).toISOString();
  const previousStart = new Date(nowMs - 2 * FIFTEEN_MINUTES_MS).toISOString();
  const [state, currentRow, previousRow, routeResults] = await Promise.all([
    env.DB.prepare(`
      SELECT notified_status, updated_at
      FROM operational_health_alert_state
      WHERE alert_key = ?
    `).bind(ALERT_KEY).first<OperationalAlertStateRow>(),
    env.DB.prepare(WINDOW_SUMMARY_SQL)
      .bind(currentStart, currentEnd)
      .first<OperationalHealthWindowRow>(),
    env.DB.prepare(WINDOW_SUMMARY_SQL)
      .bind(previousStart, currentStart)
      .first<OperationalHealthWindowRow>(),
    env.DB.prepare(`
      SELECT route, COUNT(*) AS events
      FROM operational_events
      WHERE created_at >= ? AND created_at < ?
        AND (
          (event_type = 'request_failed' AND status_code >= 500)
          OR event_type IN (
            'unhandled_exception',
            'd1_unavailable',
            'maintenance_failed',
            'cleanup_failed',
            'realtime_unavailable',
            'rate_limited'
          )
        )
      GROUP BY route
      ORDER BY events DESC, route ASC
      LIMIT 5
    `).bind(previousStart, currentEnd).all<RouteSummaryRow>(),
  ]);

  if (!state) {
    throw new Error("operational health alert state is missing; apply migration 0039");
  }

  const currentWindow = serializeOperationalHealthWindow(currentRow);
  const previousWindow = serializeOperationalHealthWindow(previousRow);
  const currentStatus = deriveOperationalHealthStatus(currentWindow);
  const previousStatus = deriveOperationalHealthStatus(previousWindow);
  const decision = getOperationalAlertDecision(
    currentStatus,
    previousStatus,
    state.notified_status,
  );
  if (!decision) {
    return { status: "unchanged" };
  }

  const idempotencyKey = [
    "operational-health",
    decision.kind,
    state.notified_status,
    state.updated_at.replace(/[^0-9A-Za-z]/g, ""),
  ].join("-");
  await sendOperationalAlertEmail({
    env,
    recipient,
    decision,
    currentStatus,
    previousStatus,
    currentWindow,
    previousWindow,
    routes: routeResults.results || [],
    generatedAt: currentEnd,
    idempotencyKey,
  });

  await env.DB.prepare(`
    UPDATE operational_health_alert_state
    SET notified_status = ?,
        last_alert_kind = ?,
        last_alert_at = ?,
        updated_at = ?
    WHERE alert_key = ?
      AND notified_status = ?
      AND updated_at = ?
  `).bind(
    decision.nextNotifiedStatus,
    decision.kind,
    currentEnd,
    currentEnd,
    ALERT_KEY,
    state.notified_status,
    state.updated_at,
  ).run();

  return { status: "delivered", kind: decision.kind };
}
