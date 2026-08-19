import type { Env } from "../types.ts";

const MAX_MESSAGE_ID_LENGTH = 128;

export function normalizeRequestedReplyId(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_MESSAGE_ID_LENGTH) return undefined;
  return normalized;
}

export async function resolveReplyRootId(
  env: Env,
  channelId: string,
  targetMessageId: string,
): Promise<string | null> {
  const root = await env.DB.prepare(`
    SELECT root_id AS id
    FROM messages
    WHERE id = ? AND channel_id = ? AND deleted = 0
      AND root_id IS NOT NULL
    LIMIT 1
  `).bind(targetMessageId, channelId).first<{ id: string }>();

  return root?.id || null;
}
