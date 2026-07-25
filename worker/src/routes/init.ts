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
  const adminDataStatus = userId === (channel as any).owner_uid
    ? (isOwner ? "authorized" : "unauthorized")
    : undefined;

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

  // Collect independent reads into one D1 batch. This removes the accumulated
  // latency of issuing messages, settings and moderation queries one by one.
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "SELECT * FROM (SELECT * FROM messages WHERE channel_id = ? AND (deleted = 0 OR (deleted = 1 AND id IN (SELECT reply_to FROM messages WHERE channel_id = ? AND deleted = 0 AND reply_to IS NOT NULL))) ORDER BY created_at DESC LIMIT 50) ORDER BY created_at ASC"
    ).bind(channelId, channelId),
    env.DB.prepare(`
      SELECT id, text FROM config
      WHERE (channel_id = ? AND id = ?)
         OR (channel_id = ? AND id IN (?, ?, ?, ?, ?))
    `).bind(
      channelId,
      `notice_${channelId}`,
      parentChannelId,
      `welcome_${parentChannelId}`,
      `live_${parentChannelId}`,
      `liveEmojis_${parentChannelId}`,
      `petition_${parentChannelId}`,
      `dm_${parentChannelId}`,
    ),
    env.DB.prepare("SELECT is_frozen FROM channels WHERE id = ?").bind(channelId),
  ];

  let blockedIndex: number | null = null;
  let viewerBlockedIndex: number | null = null;
  let dmIndex: number | null = null;
  if (isOwner) {
    blockedIndex = statements.length;
    statements.push(
      env.DB.prepare("SELECT * FROM blocked WHERE channel_id = ?").bind(parentChannelId)
    );
    dmIndex = statements.length;
    statements.push(
      env.DB.prepare(
        "SELECT * FROM (SELECT * FROM dm WHERE channel_id = ? ORDER BY created_at DESC LIMIT 50) ORDER BY created_at ASC"
      ).bind(channelId)
    );
  } else {
    const viewerUid = request.headers.get("X-Viewer-Uid") || "";
    const viewerFingerprint = request.headers.get("X-Viewer-Fingerprint") || "";
    if (viewerUid.length <= 128 && viewerFingerprint.length <= 128 && (viewerUid || viewerFingerprint)) {
      viewerBlockedIndex = statements.length;
      statements.push(
        env.DB.prepare(
          "SELECT 1 FROM blocked WHERE channel_id = ? AND (uid = ? OR fingerprint = ?) LIMIT 1"
        ).bind(parentChannelId, viewerUid, viewerFingerprint)
      );
    }
  }

  // Presence is served by the Durable Object, so it can run concurrently with
  // the single D1 batch instead of extending the critical path.
  const doId = env.CHAT_ROOM.idFromName(parentChannelId);
  const stub = env.CHAT_ROOM.get(doId);
  const [batchResults, presenceRes] = await Promise.all([
    env.DB.batch(statements),
    stub.fetch(new Request("http://internal/presence")),
  ]);
  const presence = await presenceRes.json() as { count: number };

  const messages = batchResults[0].results || [];
  const configRows = (batchResults[1].results || []) as { id: string; text: string }[];
  const config = new Map(configRows.map((row) => [row.id, row.text]));
  const liveRow = batchResults[2].results?.[0] as { is_frozen?: number } | undefined;
  const blocked = blockedIndex === null ? [] : batchResults[blockedIndex].results || [];
  const dmMessages = dmIndex === null ? [] : batchResults[dmIndex].results || [];
  const viewerBlocked = viewerBlockedIndex === null
    ? false
    : (batchResults[viewerBlockedIndex].results?.length || 0) > 0;

  // Parse live status
  let liveStatus: { active: boolean; title: string; sessionId: string } | null = null;
  const liveConfig = config.get(`live_${parentChannelId}`);
  if (liveConfig && liveConfig !== "false") {
    try { liveStatus = JSON.parse(liveConfig); } catch {}
  }

  // For live channels, override is_frozen with the _live row's value
  let responseChannel = channel;
  if (isLiveChannel && liveRow) {
    responseChannel = { ...channel, is_frozen: liveRow.is_frozen ?? 0 };
  }

  // The passcode column contains the stored credential hash. Clients only
  // need to know whether a gate exists, never the hash itself.
  const safeChannel = { ...(responseChannel as Record<string, unknown>) };
  delete safeChannel.passcode;

  return Response.json({
    channel: safeChannel,
    messages,
    blocked,
    viewerBlocked,
    dm: dmMessages || [],
    adminDataStatus,
    presence: presence.count,
    bannerNotice: config.get(`notice_${channelId}`) || "",
    welcomeConfig: config.get(`welcome_${parentChannelId}`) || "",
    live: liveStatus,
    emojiPresets: config.get(`liveEmojis_${parentChannelId}`) || null,
    petitionEnabled: config.get(`petition_${parentChannelId}`) !== "false",
    dmEnabled: config.get(`dm_${parentChannelId}`) !== "false",
  });
}
