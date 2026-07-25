import { Env } from "../types";
import { verifyRoomToken } from "./passcode";

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

  // Only the trusted app proxy can assert a user identity. Keep this check
  // independent of passcode state so public channels receive the same
  // owner-only data protection as private channels.
  const internalToken = request.headers.get("X-Internal-Token");
  const userId = request.headers.get("X-User-Id");
  const isOwner = internalToken === env.INTERNAL_SECRET
    && userId === (channel as any).owner_uid;

  // Passcode gate: if channel has passcode, verify token or owner identity
  if ((channel as any).passcode) {
    if (!isOwner) {
      const token = request.headers.get("X-Room-Token");
      if (token) {
        const decoded = await verifyRoomToken(token, env);
        if (!decoded || decoded.channel_id !== parentChannelId || decoded.passcode_hash !== (channel as any).passcode) {
          return Response.json({
            hasPasscode: true,
            channel: { id: (channel as any).id, name: (channel as any).name, profile_image: (channel as any).profile_image, bubble_color: (channel as any).bubble_color },
          });
        }
      } else {
        return Response.json({
          hasPasscode: true,
          channel: { id: (channel as any).id, name: (channel as any).name, profile_image: (channel as any).profile_image, bubble_color: (channel as any).bubble_color },
        });
      }
    }
    // Owner or valid token — continue to full data
  }

  // Fetch recent messages (from the requested channel — live or normal)
  const { results: messages } = await env.DB.prepare(
    "SELECT * FROM (SELECT * FROM messages WHERE channel_id = ? AND (deleted = 0 OR (deleted = 1 AND id IN (SELECT reply_to FROM messages WHERE channel_id = ? AND deleted = 0 AND reply_to IS NOT NULL))) ORDER BY created_at DESC LIMIT 50) ORDER BY created_at ASC"
  ).bind(channelId, channelId).all();

  // Administrative data must never be sent to ordinary channel entrants.
  let blocked: unknown[] = [];
  if (isOwner) {
    const result = await env.DB.prepare(
      "SELECT * FROM blocked WHERE channel_id = ?"
    ).bind(parentChannelId).all();
    blocked = result.results;
  }

  // Fetch banner notice from config table (from requested channel — separate for live)
  const noticeConfig = await env.DB.prepare("SELECT text FROM config WHERE id = ? AND channel_id = ?")
    .bind(`notice_${channelId}`, channelId).first();

  // Fetch welcome popup config (from parent channel)
  const welcomeConfig = await env.DB.prepare("SELECT text FROM config WHERE id = ? AND channel_id = ?")
    .bind(`welcome_${parentChannelId}`, parentChannelId).first();

  // Fetch live mode status (from parent channel)
  const liveConfig = await env.DB.prepare("SELECT text FROM config WHERE id = ? AND channel_id = ?")
    .bind(`live_${parentChannelId}`, parentChannelId).first();

  // Fetch emoji presets for live mode (from parent channel)
  const emojiPresetsConfig = await env.DB.prepare("SELECT text FROM config WHERE id = ? AND channel_id = ?")
    .bind(`liveEmojis_${parentChannelId}`, parentChannelId).first();

  // Fetch petition/dm toggle settings
  const petitionConfig = await env.DB.prepare("SELECT text FROM config WHERE id = ? AND channel_id = ?")
    .bind(`petition_${parentChannelId}`, parentChannelId).first();
  const dmConfig = await env.DB.prepare("SELECT text FROM config WHERE id = ? AND channel_id = ?")
    .bind(`dm_${parentChannelId}`, parentChannelId).first();

  let dmMessages: unknown[] = [];
  if (isOwner) {
    const result = await env.DB.prepare(
      "SELECT * FROM (SELECT * FROM dm WHERE channel_id = ? ORDER BY created_at DESC LIMIT 50) ORDER BY created_at ASC"
    ).bind(channelId).all();
    dmMessages = result.results;
  }

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

  // For live channels, override is_frozen with the _live row's value
  let responseChannel = channel;
  if (isLiveChannel) {
    const liveRow = await env.DB.prepare("SELECT is_frozen FROM channels WHERE id = ?")
      .bind(channelId).first();
    if (liveRow) {
      responseChannel = { ...channel, is_frozen: (liveRow as any).is_frozen ?? 0 };
    }
  }

  // The passcode column contains the stored credential hash. Clients only
  // need to know whether a gate exists, never the hash itself.
  const safeChannel = { ...(responseChannel as Record<string, unknown>) };
  delete safeChannel.passcode;

  return Response.json({
    channel: safeChannel,
    messages,
    blocked,
    dm: dmMessages || [],
    presence: presence.count,
    bannerNotice: noticeConfig?.text || "",
    welcomeConfig: welcomeConfig?.text || "",
    live: liveStatus,
    emojiPresets: emojiPresetsConfig?.text || null,
    petitionEnabled: petitionConfig?.text !== "false",
    dmEnabled: dmConfig?.text !== "false",
  });
}
