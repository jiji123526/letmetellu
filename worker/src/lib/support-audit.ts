import type { Env } from "../types.ts";

export async function appendSupportAuditLog(input: {
  env: Env;
  threadId: string;
  actorRole: "user" | "platform_admin" | "system";
  actorUserId?: string | null;
  action: string;
  detail?: unknown;
}): Promise<void> {
  await input.env.DB.prepare(`
    INSERT INTO support_audit_logs (
      id, thread_id, actor_role, actor_user_id, action, detail_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.threadId,
    input.actorRole,
    input.actorUserId ?? null,
    input.action,
    input.detail === undefined ? null : JSON.stringify(input.detail),
    new Date().toISOString(),
  ).run();
}
