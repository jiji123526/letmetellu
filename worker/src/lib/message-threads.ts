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
    WITH RECURSIVE ancestors(id, reply_to) AS (
      SELECT id, reply_to
      FROM messages
      WHERE id = ? AND channel_id = ? AND deleted = 0
      UNION
      SELECT parent.id, parent.reply_to
      FROM messages parent
      INNER JOIN ancestors ON ancestors.reply_to = parent.id
      WHERE parent.channel_id = ?
    )
    SELECT id
    FROM ancestors
    WHERE reply_to IS NULL
    LIMIT 1
  `).bind(targetMessageId, channelId, channelId).first<{ id: string }>();

  return root?.id || null;
}
