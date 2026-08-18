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
import { resolveUnifiedTimelineRollout } from "../lib/unified-timeline-rollout.ts";
import { resolveActiveLiveSession } from "../lib/live-sessions.ts";
import { resolveUnifiedTimelineViewer } from "../lib/unified-timeline-viewer.ts";
import { isReportsChannel } from "../lib/special-channels.ts";
import { getUserLocale } from "../lib/channel-moderation.ts";
import { getTrustedUserId } from "../lib/trusted-identity.ts";
import { getChannelPasscodeInfo } from "../lib/validation.ts";
import type { Env } from "../types.ts";
import { authorizeRoomToken } from "./passcode.ts";
import { hydrateUnifiedReportTimeline } from "./report-timeline-adapter.ts";

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

  const reportsChannel = isReportsChannel(parentChannelId, env);
  const rollout = resolveUnifiedTimelineRollout(
    env,
    parentChannelId,
    {
      live: liveChannel,
      reports: reportsChannel,
    },
  );
  if (!reportsChannel && !liveChannel && !rollout.enabled) {
    return Response.json(
      { error: "unified_timeline_disabled" },
      { status: 409 },
    );
  }
  if ((reportsChannel || liveChannel) && !rollout.enabled) {
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
  const requestedLiveSessionId = liveChannel
    ? url.searchParams.get("live_session_id") || ""
    : "";
  let liveSessionId = "";
  if (liveChannel) {
    if (!requestedLiveSessionId) {
      return Response.json(
        { error: "missing_live_session_id" },
        { status: 400 },
      );
    }
    const liveSession = await resolveActiveLiveSession(env, parentChannelId);
    if (!liveSession) {
      return Response.json({ error: "live_session_ended" }, { status: 409 });
    }
    if (liveSession.sessionId !== requestedLiveSessionId) {
      return Response.json({ error: "live_session_changed" }, { status: 409 });
    }
    liveSessionId = liveSession.sessionId;
  }
  const liveSessionStillCurrent = async () => {
    if (!liveChannel) return true;
    const current = await resolveActiveLiveSession(env, parentChannelId);
    return current?.sessionId === liveSessionId;
  };

  const targetId = url.searchParams.get("target_id");
  if (targetId) {
    const targetSource = url.searchParams.get("target_source") || "message";
    if (targetSource !== "message" && targetSource !== "dm") {
      return Response.json({ error: "invalid_target_source" }, { status: 400 });
    }
    const startedAt = performance.now();
    const selectedContextPage = await readUnifiedTimelineContextPage(
      env,
      channelId,
      viewer,
      targetSource,
      targetId,
    );
    if (!selectedContextPage) {
      return Response.json({ error: "target_not_found" }, { status: 404 });
    }
    if (!await liveSessionStillCurrent()) {
      return Response.json({ error: "live_session_changed" }, { status: 409 });
    }
    const reportsOwnerLocale = reportsChannel && trustedUserId
      ? await getUserLocale(trustedUserId, env)
      : "ko";
    const contextPage = reportsChannel
      ? {
          ...selectedContextPage,
          items: await hydrateUnifiedReportTimeline(
            selectedContextPage.items,
            env,
            reportsOwnerLocale,
          ),
        }
      : selectedContextPage;
    if (rollout.enabled) {
      logUnifiedTimelineMetric(createUnifiedTimelineMetricRecord({
        metrics: contextPage.metrics,
        owner: viewer.owner,
        readMode: "context",
        rolloutMode: rollout.mode === "global"
          ? "global"
          : rollout.mode === "sample"
          ? "sample"
          : "allowlist",
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
  const selectedPage = await readUnifiedTimelinePage(env, channelId, viewer, {
    cursor: pageRequest.cursor,
    direction: pageRequest.direction,
    limit: pageRequest.limit,
  });
  if (!await liveSessionStillCurrent()) {
    return Response.json({ error: "live_session_changed" }, { status: 409 });
  }
  const reportsOwnerLocale = reportsChannel && trustedUserId
    ? await getUserLocale(trustedUserId, env)
    : "ko";
  const page = reportsChannel
    ? {
        ...selectedPage,
        items: await hydrateUnifiedReportTimeline(
          selectedPage.items,
          env,
          reportsOwnerLocale,
        ),
      }
    : selectedPage;
  if (rollout.enabled) {
    logUnifiedTimelineMetric(createUnifiedTimelineMetricRecord({
      metrics: page.metrics,
      owner: viewer.owner,
      readMode: "page",
      rolloutMode: rollout.mode === "global"
        ? "global"
        : rollout.mode === "sample"
        ? "sample"
        : "allowlist",
      workerDurationMs: performance.now() - startedAt,
    }));
  }
  return Response.json(serializeUnifiedTimelinePage(page));
}
