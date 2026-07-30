import type { Env } from "../types";

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
