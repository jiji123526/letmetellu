import { Env } from "../types";

export async function handleInit(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel");

  if (!channelId) {
    return Response.json({ error: "missing channel" }, { status: 400 });
  }

  // Live channels use parent channel's config
  const isLiveChannel = channelId.endsWith("_live");
  const parentChannelId = isLiveChannel ? channelId.replace(/_live$/, "") : channelId;

  // Fetch channel config (always from parent)
  const channel = await env.DB.prepare("SELECT * FROM channels WHERE id = ?")
    .bind(parentChannelId).first();

  if (!channel) {
    return Response.json({ error: "channel not found" }, { status: 404 });
  }

  // Fetch recent messages (from the requested channel — live or normal)
  const { results: messages } = await env.DB.prepare(
    "SELECT * FROM (SELECT * FROM messages WHERE channel_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 50) ORDER BY created_at ASC"
  ).bind(channelId).all();

  // Fetch blocked users (from parent channel)
  const { results: blocked } = await env.DB.prepare(
    "SELECT * FROM blocked WHERE channel_id = ?"
  ).bind(parentChannelId).all();

  // Fetch banner notice from config table (from parent channel)
  const noticeConfig = await env.DB.prepare("SELECT text FROM config WHERE id = ? AND channel_id = ?")
    .bind(`notice_${parentChannelId}`, parentChannelId).first();

  // Fetch welcome popup config (from parent channel)
  const welcomeConfig = await env.DB.prepare("SELECT text FROM config WHERE id = ? AND channel_id = ?")
    .bind(`welcome_${parentChannelId}`, parentChannelId).first();

  // Fetch live mode status (from parent channel)
  const liveConfig = await env.DB.prepare("SELECT text FROM config WHERE id = ? AND channel_id = ?")
    .bind(`live_${parentChannelId}`, parentChannelId).first();

  // Fetch emoji presets for live mode (from parent channel)
  const emojiPresetsConfig = await env.DB.prepare("SELECT text FROM config WHERE id = ? AND channel_id = ?")
    .bind(`liveEmojis_${parentChannelId}`, parentChannelId).first();

  // Fetch DM messages (visible to admin only — frontend filters)
  const { results: dmMessages } = await env.DB.prepare(
    "SELECT * FROM (SELECT * FROM dm WHERE channel_id = ? ORDER BY created_at DESC LIMIT 50) ORDER BY created_at ASC"
  ).bind(channelId).all();

  // Gallery fetched on-demand when panel opens (not included in init to save payload)

  // Get presence count from DO (always from parent channel where clients connect)
  const doId = env.CHAT_ROOM.idFromName(parentChannelId);
  const stub = env.CHAT_ROOM.get(doId);
  const presenceRes = await stub.fetch(new Request("http://internal/presence"));
  const presence = await presenceRes.json() as { count: number };

  // Parse live status
  let liveStatus: { active: boolean; title: string; sessionId: string } | null = null;
  if (liveConfig?.text && liveConfig.text !== "false") {
    try { liveStatus = JSON.parse(liveConfig.text as string); } catch {}
  }

  return Response.json({
    channel,
    messages,
    blocked,
    dm: dmMessages || [],
    presence: presence.count,
    bannerNotice: noticeConfig?.text || "",
    welcomeConfig: welcomeConfig?.text || "",
    live: liveStatus,
    emojiPresets: emojiPresetsConfig?.text || null,
  });
}
