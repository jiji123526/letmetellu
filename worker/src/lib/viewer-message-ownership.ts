import type { Env } from "../types.ts";

const OWNERSHIP_LOOKUP_CHUNK_SIZE = 50;

export async function markViewerOwnedMessages<T extends {
  id: string;
  source?: string;
  dm?: boolean;
}>(
  env: Env,
  channelId: string,
  accountUid: string | null,
  messages: T[],
): Promise<Array<T & { viewer_owned?: true }>> {
  if (!accountUid || messages.length === 0) return messages;

  const messageIds = [...new Set(
    messages
      .filter((message) => message.source !== "dm" && !message.dm)
      .map((message) => message.id),
  )];
  if (messageIds.length === 0) return messages;

  const parentChannelId = channelId.endsWith("_live")
    ? channelId.slice(0, -5)
    : channelId;
  const ownedIds = new Set<string>();
  for (let offset = 0; offset < messageIds.length; offset += OWNERSHIP_LOOKUP_CHUNK_SIZE) {
    const chunk = messageIds.slice(offset, offset + OWNERSHIP_LOOKUP_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await env.DB.prepare(`
      SELECT message_id
      FROM message_notification_owners
      WHERE channel_id = ?
        AND user_id = ?
        AND message_id IN (${placeholders})
    `).bind(parentChannelId, accountUid, ...chunk).all<{ message_id: string }>();
    for (const row of result.results || []) ownedIds.add(row.message_id);
  }

  return messages.map((message) =>
    ownedIds.has(message.id)
      ? { ...message, viewer_owned: true as const }
      : message
  );
}
