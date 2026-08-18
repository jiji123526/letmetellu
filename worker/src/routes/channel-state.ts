import { getChannelModeration } from "../lib/channel-moderation";
import { getParentChannelId } from "../lib/special-channels";
import type { Env } from "../types";

export async function handleChannelState(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  if (request.headers.get("X-Internal-Token") !== env.INTERNAL_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = request.headers.get("X-User-Id") || "";
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel") || "";
  if (!channelId) {
    return Response.json({ error: "missing channel" }, { status: 400 });
  }

  const parentChannelId = getParentChannelId(channelId);
  const parentChannel = await env.DB.prepare(`
    SELECT owner_uid, is_frozen
    FROM channels
    WHERE id = ?
    LIMIT 1
  `).bind(parentChannelId).first<{ owner_uid: string; is_frozen: number }>();
  if (!parentChannel) {
    return Response.json({ error: "channel not found" }, { status: 404 });
  }
  if (parentChannel.owner_uid !== userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const liveChannel = channelId !== parentChannelId
    ? await env.DB.prepare(`
      SELECT is_frozen
      FROM channels
      WHERE id = ?
      LIMIT 1
    `).bind(channelId).first<{ is_frozen: number }>()
    : null;
  const moderation = await getChannelModeration(parentChannelId, env);

  return Response.json({
    channel: {
      id: channelId,
      is_frozen: channelId === parentChannelId
        ? parentChannel.is_frozen
        : liveChannel?.is_frozen ?? 0,
    },
    ownerModeration: {
      status: moderation.status,
      petitionStatus: moderation.petition_status,
    },
  });
}
