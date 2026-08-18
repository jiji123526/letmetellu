import {
  parseUnifiedTimelinePageRequest,
  serializeUnifiedTimelinePage,
} from "../lib/unified-timeline-api.ts";
import { readUnifiedTimelinePage } from "../lib/unified-timeline-reader.ts";
import { resolveUnifiedTimelineViewer } from "../lib/unified-timeline-viewer.ts";
import { isReportsChannel } from "../lib/special-channels.ts";
import { getTrustedUserId } from "../lib/trusted-identity.ts";
import { getChannelPasscodeInfo } from "../lib/validation.ts";
import type { Env } from "../types.ts";
import { authorizeRoomToken } from "./passcode.ts";

export async function handleUnifiedTimeline(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel") || "";
  if (!channelId) {
    return Response.json({ error: "missing channel" }, { status: 400 });
  }

  const liveChannel = channelId.endsWith("_live");
  const parentChannelId = liveChannel
    ? channelId.replace(/_live$/, "")
    : channelId;
  const { exists, passcode, owner_uid: ownerId } = await getChannelPasscodeInfo(
    parentChannelId,
    env,
  );
  if (!exists) {
    return Response.json({ error: "channel not found" }, { status: 404 });
  }

  const trustedUserId = getTrustedUserId(request, env);
  const isOwner = Boolean(trustedUserId && trustedUserId === ownerId);
  if (isReportsChannel(parentChannelId, env) && !isOwner) {
    return Response.json({ error: "owner access required" }, { status: 403 });
  }

  if (passcode && !isOwner) {
    const roomToken = request.headers.get("X-Room-Token");
    if (!roomToken) {
      return Response.json({ error: "passcode required" }, { status: 403 });
    }
    const authorized = await authorizeRoomToken(
      roomToken,
      parentChannelId,
      passcode,
      env,
    );
    if (!authorized) {
      return Response.json({ error: "invalid token" }, { status: 403 });
    }
  }

  if (liveChannel || isReportsChannel(parentChannelId, env)) {
    return Response.json(
      { error: "unified_timeline_unsupported" },
      { status: 409 },
    );
  }

  const pageRequest = parseUnifiedTimelinePageRequest(url.searchParams);
  if (!pageRequest.ok) {
    return Response.json({ error: pageRequest.error }, { status: 400 });
  }

  const viewer = await resolveUnifiedTimelineViewer(request, env, isOwner);
  if (!viewer) {
    return Response.json(
      { error: "anonymous_identity_required" },
      { status: 401 },
    );
  }

  const page = await readUnifiedTimelinePage(env, channelId, viewer, {
    cursor: pageRequest.cursor,
    direction: pageRequest.direction,
    limit: pageRequest.limit,
  });
  return Response.json(serializeUnifiedTimelinePage(page));
}
