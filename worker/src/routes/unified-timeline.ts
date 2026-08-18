import {
  parseUnifiedTimelinePageRequest,
  serializeUnifiedTimelinePage,
} from "../lib/unified-timeline-api.ts";
import {
  readUnifiedTimelineContextPage,
  readUnifiedTimelinePage,
} from "../lib/unified-timeline-reader.ts";
import {
  createUnifiedTimelineMetricRecord,
  logUnifiedTimelineMetric,
} from "../lib/unified-timeline-metrics.ts";
import { isUnifiedTimelineClientEnabled } from "../lib/unified-timeline-rollout.ts";
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

  const targetId = url.searchParams.get("target_id");
  if (targetId) {
    const targetSource = url.searchParams.get("target_source") || "message";
    if (targetSource !== "message" && targetSource !== "dm") {
      return Response.json({ error: "invalid_target_source" }, { status: 400 });
    }
    const startedAt = performance.now();
    const contextPage = await readUnifiedTimelineContextPage(
      env,
      channelId,
      viewer,
      targetSource,
      targetId,
    );
    if (!contextPage) {
      return Response.json({ error: "target_not_found" }, { status: 404 });
    }
    if (isUnifiedTimelineClientEnabled(env, channelId)) {
      logUnifiedTimelineMetric(createUnifiedTimelineMetricRecord({
        metrics: contextPage.metrics,
        owner: viewer.owner,
        readMode: "context",
        workerDurationMs: performance.now() - startedAt,
      }));
    }
    return Response.json({
      ...serializeUnifiedTimelinePage(contextPage),
      target_id: contextPage.targetId,
      target_source: contextPage.targetSource,
      has_older: contextPage.hasOlder,
      has_newer: contextPage.hasNewer,
    });
  }

  const startedAt = performance.now();
  const page = await readUnifiedTimelinePage(env, channelId, viewer, {
    cursor: pageRequest.cursor,
    direction: pageRequest.direction,
    limit: pageRequest.limit,
  });
  if (isUnifiedTimelineClientEnabled(env, channelId)) {
    logUnifiedTimelineMetric(createUnifiedTimelineMetricRecord({
      metrics: page.metrics,
      owner: viewer.owner,
      readMode: "page",
      workerDurationMs: performance.now() - startedAt,
    }));
  }
  return Response.json(serializeUnifiedTimelinePage(page));
}
