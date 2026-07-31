import type { Env } from "../types";

export function messageHasLinks(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.includes("http://") || text.includes("https://") || text.includes("www.");
}

export async function syncMessageLink(
  env: Env,
  messageId: string,
  channelId: string,
  createdAt: string,
  text: string | null | undefined,
): Promise<void> {
  if (messageHasLinks(text)) {
    await env.DB.prepare(
      `INSERT INTO message_links (message_id, channel_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET
         channel_id = excluded.channel_id,
         created_at = excluded.created_at`
    ).bind(messageId, channelId, createdAt).run();
    return;
  }

  await env.DB.prepare("DELETE FROM message_links WHERE message_id = ?")
    .bind(messageId)
    .run();
}
