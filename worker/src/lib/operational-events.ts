import type { Env } from "../types";

export const OPERATIONAL_EVENT_OVERRIDE_HEADER = "X-Letmetellu-Operational-Event";
const OPERATIONAL_ERROR_DETAIL = Symbol("letmetellu.operational-error-detail");

export type OperationalErrorDetail = Record<string, unknown>;

export async function recordOperationalEvent(input: {
  env: Env;
  severity: "info" | "warn" | "error";
  route: string;
  eventType: string;
  statusCode?: number;
  actorUserId?: string | null;
  targetId?: string | null;
  detail?: unknown;
}): Promise<void> {
  try {
    await input.env.DB.prepare(`
      INSERT INTO operational_events (
        id, severity, route, event_type, status_code, actor_user_id, target_id, detail_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.severity,
      input.route,
      input.eventType,
      input.statusCode ?? null,
      input.actorUserId ?? null,
      input.targetId ?? null,
      input.detail === undefined ? null : JSON.stringify(input.detail),
      new Date().toISOString(),
    ).run();
  } catch (error) {
    console.warn("failed to record operational event", error);
  }
}

export function getOperationalEventOverride(response: Response): string | null {
  return response.headers.get(OPERATIONAL_EVENT_OVERRIDE_HEADER);
}

export function withOperationalEventOverride(response: Response, eventType: string): Response {
  const headers = new Headers(response.headers);
  headers.set(OPERATIONAL_EVENT_OVERRIDE_HEADER, eventType);
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export function stripOperationalEventHeaders(headers: Headers): void {
  headers.delete(OPERATIONAL_EVENT_OVERRIDE_HEADER);
}

export function normalizeOperationalRoute(method: string, pathname: string): string {
  const normalizedMethod = method.toUpperCase();
  if (pathname.startsWith("/ws/")) {
    return `${normalizedMethod} /ws/:channel`;
  }
  if (pathname.startsWith("/api/media/")) {
    return `${normalizedMethod} /api/media/:key`;
  }
  return `${normalizedMethod} ${pathname}`;
}

export function getOperationalRouteDetail(pathname: string): OperationalErrorDetail | null {
  if (!pathname.startsWith("/ws/")) {
    if (!pathname.startsWith("/api/media/")) {
      return null;
    }
    const mediaKey = decodeURIComponent(pathname.replace("/api/media/", ""));
    const requestChannelId = mediaKey.split("/")[0] || null;
    return {
      route_group: "media",
      request_channel_id: requestChannelId,
      request_media_key: mediaKey,
    };
  }
  const channelId = pathname.split("/ws/")[1]?.split("/")[0] || null;
  return {
    route_group: "websocket",
    request_channel_id: channelId,
  };
}

export function withOperationalErrorContext(error: unknown, detail: OperationalErrorDetail): Error {
  const target = error instanceof Error ? error : new Error(String(error));
  const existingDetail = getOperationalErrorDetail(target) || {};
  Object.defineProperty(target, OPERATIONAL_ERROR_DETAIL, {
    value: {
      ...existingDetail,
      ...detail,
    },
    configurable: true,
    enumerable: false,
    writable: true,
  });
  return target;
}

export function getOperationalErrorDetail(error: unknown): OperationalErrorDetail | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const detail = (error as Error & { [OPERATIONAL_ERROR_DETAIL]?: unknown })[OPERATIONAL_ERROR_DETAIL];
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    return null;
  }
  return detail as OperationalErrorDetail;
}
