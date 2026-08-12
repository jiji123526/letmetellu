export interface OperationalHealthWindowRow {
  tracked_event_count?: number | string | null;
  request_5xx_count?: number | string | null;
  preview_upstream_failure_count?: number | string | null;
  unhandled_exception_count?: number | string | null;
  maintenance_failure_count?: number | string | null;
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
    rate_limited_count: count(row?.rate_limited_count),
    forbidden_count: count(row?.forbidden_count),
    media_not_found_count: count(row?.media_not_found_count),
  };
}

export type OperationalHealthStatus = "healthy" | "degraded" | "critical";

export function deriveOperationalHealthStatus(window: OperationalHealthWindow): OperationalHealthStatus {
  if (
    window.maintenance_failure_count > 0
    || window.request_5xx_count >= 5
    || window.unhandled_exception_count >= 3
  ) {
    return "critical";
  }
  if (
    window.request_5xx_count > 0
    || window.unhandled_exception_count > 0
    || window.rate_limited_count >= 25
  ) {
    return "degraded";
  }
  return "healthy";
}
