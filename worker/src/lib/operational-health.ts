export interface OperationalHealthWindowRow {
  tracked_event_count?: number | string | null;
  request_5xx_count?: number | string | null;
  preview_upstream_failure_count?: number | string | null;
  unhandled_exception_count?: number | string | null;
  maintenance_failure_count?: number | string | null;
  cleanup_failure_count?: number | string | null;
  realtime_failure_count?: number | string | null;
  rate_limited_count?: number | string | null;
  forbidden_count?: number | string | null;
  media_not_found_count?: number | string | null;
}

export interface OperationalHealthWindow {
  tracked_event_count: number;
  request_5xx_count: number;
  preview_upstream_failure_count: number;
  unhandled_exception_count: number;
  maintenance_failure_count: number;
  cleanup_failure_count: number;
  realtime_failure_count: number;
  rate_limited_count: number;
  forbidden_count: number;
  media_not_found_count: number;
}

function count(value: number | string | null | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function serializeOperationalHealthWindow(
  row: OperationalHealthWindowRow | null | undefined,
): OperationalHealthWindow {
  return {
    tracked_event_count: count(row?.tracked_event_count),
    request_5xx_count: count(row?.request_5xx_count),
    preview_upstream_failure_count: count(row?.preview_upstream_failure_count),
    unhandled_exception_count: count(row?.unhandled_exception_count),
    maintenance_failure_count: count(row?.maintenance_failure_count),
    cleanup_failure_count: count(row?.cleanup_failure_count),
    realtime_failure_count: count(row?.realtime_failure_count),
    rate_limited_count: count(row?.rate_limited_count),
    forbidden_count: count(row?.forbidden_count),
    media_not_found_count: count(row?.media_not_found_count),
  };
}

export type OperationalHealthStatus = "healthy" | "degraded" | "critical";

export const OPERATIONAL_HEALTH_THRESHOLDS = {
  critical_15m: {
    request_5xx_count: 5,
    unhandled_exception_count: 3,
    maintenance_failure_count: 1,
  },
  degraded_15m: {
    request_5xx_count: 1,
    unhandled_exception_count: 1,
    cleanup_failure_count: 1,
    realtime_failure_count: 1,
    rate_limited_count: 25,
  },
} as const;

export function deriveOperationalHealthStatus(window: OperationalHealthWindow): OperationalHealthStatus {
  const { critical_15m: critical, degraded_15m: degraded } = OPERATIONAL_HEALTH_THRESHOLDS;
  if (
    window.maintenance_failure_count >= critical.maintenance_failure_count
    || window.request_5xx_count >= critical.request_5xx_count
    || window.unhandled_exception_count >= critical.unhandled_exception_count
  ) {
    return "critical";
  }
  if (
    window.request_5xx_count >= degraded.request_5xx_count
    || window.unhandled_exception_count >= degraded.unhandled_exception_count
    || window.cleanup_failure_count >= degraded.cleanup_failure_count
    || window.realtime_failure_count >= degraded.realtime_failure_count
    || window.rate_limited_count >= degraded.rate_limited_count
  ) {
    return "degraded";
  }
  return "healthy";
}
