import { Env } from "../types";

export async function handleInit(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel");

  if (!channelId) {
    return Response.json({ error: "missing channel" }, { status: 400 });
  }

  // Fetch channel config
  const channel = await env.DB.prepare("SELECT * FROM channels WHERE id = ?")
    .bind(channelId).first();

  if (!channel) {
    return Response.json({ error: "channel not found" }, { status: 404 });
  }

  // Fetch recent messages
  const { results: messages } = await env.DB.prepare(
    "SELECT * FROM messages WHERE channel_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 50"
  ).bind(channelId).all();

  // Fetch blocked users
  const { results: blocked } = await env.DB.prepare(
    "SELECT * FROM blocked WHERE channel_id = ?"
  ).bind(channelId).all();

  // Fetch banner notice from config table
  const noticeConfig = await env.DB.prepare("SELECT text FROM config WHERE id = ? AND channel_id = ?")
    .bind(`notice_${channelId}`, channelId).first();

  // Get presence count from DO
  const doId = env.CHAT_ROOM.idFromName(channelId);
  const stub = env.CHAT_ROOM.get(doId);
  const presenceRes = await stub.fetch(new Request("http://internal/presence"));
  const presence = await presenceRes.json() as { count: number };

  return Response.json({
    channel,
    messages: messages.reverse(), // oldest first for display
    blocked,
    presence: presence.count,
    bannerNotice: noticeConfig?.text || "",
  });
}
