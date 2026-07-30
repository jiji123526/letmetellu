import type { Env } from "../types";

export async function appendModerationAuditLog(input: {
  env: Env;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await input.env.DB.prepare(`
    INSERT INTO moderation_audit_logs (
      id, actor_user_id, action, target_type, target_id, reason, before_json, after_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.actorUserId,
    input.action,
    input.targetType,
    input.targetId,
    input.reason || null,
    input.before === undefined ? null : JSON.stringify(input.before),
    input.after === undefined ? null : JSON.stringify(input.after),
    new Date().toISOString(),
  ).run();
}
