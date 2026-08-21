import {
  applyFreeChannelAppearance,
  getChannelAppearanceVersion,
  resetPersistedChannelAppearanceIfNeeded,
} from "../lib/channel-appearance";
import { getChannelModeration } from "../lib/channel-moderation";
import { buildOwnerPlanState } from "../lib/plan-feature-gates";
import {
  buildOwnerPlanBillingSummary,
  ensureBetaGrandfatheredPlusEntitlement,
} from "../lib/plan-entitlements";
import { getParentChannelId, isReportsChannel } from "../lib/special-channels";
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
    SELECT owner_uid, is_frozen, instance_id, bubble_color,
           background_type, background_color, background_image,
           background_overlay, background_blur
    FROM channels
    WHERE id = ?
    LIMIT 1
  `).bind(parentChannelId).first<{
    owner_uid: string;
    is_frozen: number;
    instance_id: string | null;
    bubble_color: string | null;
    background_type: "default" | "color" | "image" | null;
    background_color: string | null;
    background_image: string | null;
    background_overlay: number | null;
    background_blur: number | null;
  }>();
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
  const [moderation, activePlusEntitlement] = await Promise.all([
    getChannelModeration(parentChannelId, env),
    ensureBetaGrandfatheredPlusEntitlement(env, userId),
  ]);
  if (!activePlusEntitlement && !isReportsChannel(parentChannelId, env)) {
    await resetPersistedChannelAppearanceIfNeeded(env, parentChannelId, parentChannel);
  }
  const responseAppearance = activePlusEntitlement || isReportsChannel(parentChannelId, env)
    ? parentChannel
    : applyFreeChannelAppearance(parentChannel);

  return Response.json({
    channel: {
      id: channelId,
      instance_id: responseAppearance.instance_id,
      is_frozen: channelId === parentChannelId
        ? parentChannel.is_frozen
        : liveChannel?.is_frozen ?? 0,
      bubble_color: responseAppearance.bubble_color,
      appearance_version: getChannelAppearanceVersion(responseAppearance),
      background_type: responseAppearance.background_type,
      background_color: responseAppearance.background_color,
      background_image: responseAppearance.background_image,
      background_overlay: responseAppearance.background_overlay,
      background_blur: responseAppearance.background_blur,
    },
    ownerModeration: {
      status: moderation.status,
      petitionStatus: moderation.petition_status,
    },
    ownerPlan: {
      ...buildOwnerPlanState(Boolean(activePlusEntitlement)),
      billingSummary: buildOwnerPlanBillingSummary(activePlusEntitlement),
    },
  });
}
