import { Env } from "../types";
import { createAnonymousIdentity, createDeviceIdentity, verifyAnonymousIdentityToken, verifyDeviceIdentityToken } from "../lib/anonymous-identity";
import { getBlockedDeviceLookup } from "../lib/actor-identities";
import { getChannelModeration, getUserLocale } from "../lib/channel-moderation";
import {
  endLiveSession,
  isLiveSessionExpired,
  parseLiveSessionState,
  resolveActiveLiveSession,
  type LiveSessionState,
} from "../lib/live-sessions";
import { withOperationalErrorContext } from "../lib/operational-events";
import { getReportsChannelId, getReportsChannelOwnerId, isPlatformAdmin, isReportsChannel } from "../lib/special-channels";
import { readVisibleMessagePage } from "../lib/visible-messages";
import { readDmThreads } from "../lib/dm-threads";
import { resolveUnifiedTimelineRollout } from "../lib/unified-timeline-rollout";
import { readSelectedBootstrap } from "../lib/bootstrap-read-mode";
import { getChannelAppearanceVersion } from "../lib/channel-appearance";
import { readUnifiedTimelinePage } from "../lib/unified-timeline-reader";
import { serializeUnifiedTimelinePage } from "../lib/unified-timeline-api";
import {
  createUnifiedTimelineMetricRecord,
  logUnifiedTimelineMetric,
} from "../lib/unified-timeline-metrics";
import { hydrateReportInboxMessages } from "./channel-reports";
import { hydrateUnifiedReportTimeline } from "./report-timeline-adapter";
import { authorizeRoomToken, createRoomToken } from "./passcode";

function markProtectedSenders<T extends Record<string, unknown>>(
  rows: T[],
  protectedUid: string | null,
): Array<T & { protected_sender?: boolean }> {
  if (!protectedUid) {
    return rows.map((row) => (
      row.uid === "system-moderation"
        ? { ...row, protected_sender: true }
        : row
    )) as Array<T & { protected_sender?: boolean }>;
  }
  return rows.map((row) => (
    row.uid === "system-moderation" || row.uid === protectedUid || row.auth_uid === protectedUid
      ? { ...row, protected_sender: true }
      : row
  ));
}

export async function handleInit(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel");

  if (!channelId) {
    return Response.json({ error: "missing channel" }, { status: 400 });
  }

  const isLiveChannel = channelId.endsWith("_live");
  const parentChannelId = isLiveChannel ? channelId.replace(/_live$/, "") : channelId;
  const reportsChannel = isReportsChannel(parentChannelId, env);
  const reportsChannelId = getReportsChannelId(env);
  let routeStage = "load_channel";

  try {
    // Fetch channel config (always from parent)
    const channel = await env.DB.prepare(
      `SELECT
         channels.*,
         users.name AS owner_name,
         channel_moderation.status AS moderation_status,
         CASE
           WHEN channels.show_on_profile = 1 THEN
             CASE
               WHEN EXISTS(
                 SELECT 1
                 FROM channels AS owner_channels
                 WHERE owner_channels.owner_uid = channels.owner_uid
                   AND owner_channels.show_on_profile = 1
                   AND owner_channels.id NOT LIKE '%_live'
                   AND owner_channels.id != channels.id
                   ${reportsChannelId ? "AND owner_channels.id != ?" : ""}
                 LIMIT 1
               ) THEN 2
               ELSE 1
             END
           ELSE 0
         END AS owner_channel_count
       FROM channels
       LEFT JOIN users ON users.id = channels.owner_uid
       LEFT JOIN channel_moderation ON channel_moderation.channel_id = channels.id
       WHERE channels.id = ?`
    )
      .bind(
        ...(reportsChannelId ? [reportsChannelId] : []),
        parentChannelId,
      ).first();

    if (!channel) {
      return Response.json({ error: "channel not found" }, { status: 404 });
    }

    routeStage = "resolve_viewer_identity";

    // Only the trusted app proxy can assert a user identity. Keep this check
    // independent of passcode state so public channels receive the same
    // owner-only data protection as private channels.
    const internalToken = request.headers.get("X-Internal-Token");
    const userId = request.headers.get("X-User-Id");
    const trustedUserId = internalToken === env.INTERNAL_SECRET && userId ? userId : "";
    const isOwner = trustedUserId === (channel as any).owner_uid;
    const isPlatformAdminViewer = !isOwner
      && Boolean((channel as any).passcode)
      && await isPlatformAdmin(trustedUserId, env);
    const adminDataStatus = userId === (channel as any).owner_uid
      ? (isOwner ? "authorized" : "unauthorized")
      : undefined;
    if (reportsChannel && !isOwner) {
      return Response.json({ error: "owner access required" }, { status: 403 });
    }
    const anonymousToken = request.headers.get("X-Anonymous-Token") || "";
    const deviceToken = request.headers.get("X-Device-Token") || "";
    const verifiedAnonymous = anonymousToken
      ? await verifyAnonymousIdentityToken(anonymousToken, env)
      : null;
    const verifiedDevice = deviceToken
      ? await verifyDeviceIdentityToken(deviceToken, env)
      : null;
    const anonymousIdentity = verifiedAnonymous
      ? { uid: verifiedAnonymous.uid, token: anonymousToken }
      : await createAnonymousIdentity(env);
    const deviceIdentity = verifiedDevice
      ? { deviceId: verifiedDevice.device_id, token: deviceToken }
      : await createDeviceIdentity(env);

    routeStage = "verify_room_access";

    // Passcode gate: if channel has passcode, verify token or owner identity
    if ((channel as any).passcode) {
      if (!isOwner && !isPlatformAdminViewer) {
        const token = request.headers.get("X-Room-Token");
        if (token) {
          const decoded = await authorizeRoomToken(token, parentChannelId, (channel as any).passcode, env);
          if (!decoded) {
            return Response.json({
              hasPasscode: true,
              passcodeHint: (channel as any).passcode_hint || "",
              channel: {
                id: (channel as any).id,
                name: (channel as any).name,
                profile_image: (channel as any).profile_image,
                bubble_color: (channel as any).bubble_color,
                appearance_version: getChannelAppearanceVersion(channel as {
                  bubble_color?: string | null;
                  background_type?: "default" | "color" | "image";
                  background_color?: string | null;
                  background_image?: string | null;
                  background_overlay?: number | null;
                  background_blur?: number | boolean | null;
                }),
              },
              anonymousUid: anonymousIdentity.uid,
              anonymousToken: anonymousIdentity.token,
              deviceToken: deviceIdentity.token,
            });
          }
        } else {
          return Response.json({
            hasPasscode: true,
            passcodeHint: (channel as any).passcode_hint || "",
            channel: {
              id: (channel as any).id,
              name: (channel as any).name,
              profile_image: (channel as any).profile_image,
              bubble_color: (channel as any).bubble_color,
              appearance_version: getChannelAppearanceVersion(channel as {
                bubble_color?: string | null;
                background_type?: "default" | "color" | "image";
                background_color?: string | null;
                background_image?: string | null;
                background_overlay?: number | null;
                background_blur?: number | boolean | null;
              }),
            },
            anonymousUid: anonymousIdentity.uid,
            anonymousToken: anonymousIdentity.token,
            deviceToken: deviceIdentity.token,
          });
        }
      }
      // Owner or valid token — continue to full data
    }

    const unifiedTimelineRollout = resolveUnifiedTimelineRollout(
      env,
      parentChannelId,
      {
        live: isLiveChannel,
        reports: reportsChannel,
      },
    );
    const unifiedTimelineRequested = unifiedTimelineRollout.enabled;
    const liveTimelineSession = isLiveChannel && unifiedTimelineRequested
      ? await resolveActiveLiveSession(env, parentChannelId)
      : null;
    const unifiedTimelineEnabled = unifiedTimelineRequested
      && (!isLiveChannel || liveTimelineSession !== null);

    routeStage = "prepare_bootstrap_batch";

    // Collect independent reads into one D1 batch. This removes the accumulated
    // latency of issuing messages, settings and moderation queries one by one.
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        SELECT id, text, updated_at FROM config
        WHERE id IN (?, ?, ?, ?, ?, ?)
      `).bind(
        `notice_${channelId}`,
        `welcome_${parentChannelId}`,
        `live_${parentChannelId}`,
        `liveEmojis_${parentChannelId}`,
        `petition_${parentChannelId}`,
        `dm_${parentChannelId}`,
      ),
    ];
    const liveChannelFrozenIndex = isLiveChannel ? statements.length : null;
    if (isLiveChannel) {
      statements.push(
        env.DB.prepare("SELECT is_frozen FROM channels WHERE id = ?").bind(channelId)
      );
    }

    routeStage = "prepare_viewer_block_lookup";

    let blockedIndex: number | null = null;
    let viewerBlockedIndex: number | null = null;
    if (isOwner) {
      blockedIndex = statements.length;
      statements.push(
        env.DB.prepare("SELECT * FROM blocked WHERE channel_id = ?").bind(parentChannelId)
      );
    } else {
      const viewerUid = anonymousIdentity.uid;
      const viewerDeviceId = deviceIdentity.deviceId;
      if (viewerUid.length <= 128 && viewerDeviceId.length <= 128 && (viewerUid || viewerDeviceId)) {
        const viewerDeviceLookup = await getBlockedDeviceLookup(viewerDeviceId, env);
        viewerBlockedIndex = statements.length;
        statements.push(
          env.DB.prepare(
            "SELECT 1 FROM blocked WHERE channel_id = ? AND (uid = ? OR device_id = ? OR device_id = ? OR fingerprint = ?) LIMIT 1"
          ).bind(parentChannelId, viewerUid, viewerDeviceLookup.raw, viewerDeviceLookup.hashed, viewerDeviceLookup.raw)
        );
      }
    }

    routeStage = "load_bootstrap_data";

    const [bootstrap, batchResults] = await Promise.all([
      readSelectedBootstrap(unifiedTimelineEnabled, {
        legacy: async () => {
          const [messagePage, dmMessages] = await Promise.all([
            readVisibleMessagePage(env, channelId, { limit: 50 }),
            readDmThreads(
              env,
              channelId,
              isOwner
                ? { owner: true }
                : { owner: false, anonymousUid: anonymousIdentity.uid },
            ),
          ]);
          return { messagePage, dmMessages };
        },
        unified: async () => {
          const startedAt = performance.now();
          const page = await readUnifiedTimelinePage(
            env,
            channelId,
            isOwner
              ? { owner: true }
              : { owner: false, anonymousUid: anonymousIdentity.uid },
          );
          logUnifiedTimelineMetric(createUnifiedTimelineMetricRecord({
            metrics: page.metrics,
            owner: isOwner,
            readMode: "page",
            rolloutMode: unifiedTimelineRollout.mode === "global"
              ? "global"
              : unifiedTimelineRollout.mode === "sample"
              ? "sample"
              : "allowlist",
            workerDurationMs: performance.now() - startedAt,
          }));
          return page;
        },
      }),
      env.DB.batch(statements),
    ]);

    const messagePage = bootstrap.mode === "legacy"
      ? bootstrap.value.messagePage
      : null;
    const dmMessages = bootstrap.mode === "legacy"
      ? bootstrap.value.dmMessages
      : [];
    let unifiedPage = bootstrap.mode === "unified"
      ? bootstrap.value
      : null;
    let responseUnifiedTimelineEnabled = unifiedTimelineEnabled;
    let liveTimelineSessionAfterRead: LiveSessionState | null | undefined;
    if (unifiedPage && liveTimelineSession) {
      const currentLiveSession = await resolveActiveLiveSession(env, parentChannelId);
      liveTimelineSessionAfterRead = currentLiveSession;
      if (currentLiveSession?.sessionId !== liveTimelineSession.sessionId) {
        unifiedPage = null;
        responseUnifiedTimelineEnabled = false;
      }
    }
    const rawMessages = messagePage?.messages || [];
    const configRows = (batchResults[0].results || []) as { id: string; text: string; updated_at?: string | null }[];
    const config = new Map(configRows.map((row) => [row.id, row.text]));
    const liveRow = liveChannelFrozenIndex === null
      ? undefined
      : batchResults[liveChannelFrozenIndex].results?.[0] as { is_frozen?: number } | undefined;
    const blocked = blockedIndex === null ? [] : batchResults[blockedIndex].results || [];
    const viewerBlocked = viewerBlockedIndex === null
      ? false
      : (batchResults[viewerBlockedIndex].results?.length || 0) > 0;

    routeStage = "parse_live_state";

    // Parse live status
    let liveStatus: LiveSessionState | null = null;
    const liveConfigRow = configRows.find((row) => row.id === `live_${parentChannelId}`);
    liveStatus = parseLiveSessionState(liveConfigRow?.text, liveConfigRow?.updated_at);
    if (isLiveSessionExpired(liveStatus)) {
      routeStage = "expire_live_state";
      await endLiveSession(env, parentChannelId, "expired", liveStatus!.sessionId);
      liveStatus = null;
    }
    if (liveTimelineSessionAfterRead !== undefined) {
      liveStatus = liveTimelineSessionAfterRead;
    }

    routeStage = "finalize_channel_state";

    // For live channels, override is_frozen with the _live row's value
    let responseChannel = channel;
    if (isLiveChannel && liveRow) {
      responseChannel = { ...channel, is_frozen: liveRow.is_frozen ?? 0 };
    }
    const moderationStatus = typeof (channel as { moderation_status?: unknown }).moderation_status === "string"
      ? (channel as { moderation_status?: string }).moderation_status || null
      : null;
    const viewerModerationStatus = !isOwner
      && moderationStatus === "frozen"
        ? "frozen"
        : null;

    // The passcode column contains the stored credential hash. Clients only
    // need to know whether a gate exists, never the hash itself.
    const safeChannel = { ...(responseChannel as Record<string, unknown>) };
    delete safeChannel.passcode;
    safeChannel.owner_channel_count = Math.min(
      Number((channel as { owner_channel_count?: unknown }).owner_channel_count) || 0,
      2,
    );
    safeChannel.appearance_version = getChannelAppearanceVersion(responseChannel as {
      bubble_color?: string | null;
      background_type?: "default" | "color" | "image";
      background_color?: string | null;
      background_image?: string | null;
      background_overlay?: number | null;
      background_blur?: number | boolean | null;
    });

    const ownerRoomToken = isOwner && (channel as any).passcode
      ? await createRoomToken(parentChannelId, (channel as any).passcode, env)
      : undefined;
    const ownerModeration = isOwner
      ? await getChannelModeration(parentChannelId, env)
      : null;
    const reportsOwnerId = await getReportsChannelOwnerId(env);
    const reportsOwnerLocale = reportsChannel && isOwner
      ? await getUserLocale(trustedUserId, env)
      : "ko";
    const messages = reportsChannel && isOwner
      ? await hydrateReportInboxMessages(rawMessages as Array<{ id: string }>, env, reportsOwnerLocale)
      : rawMessages;
    const protectedMessages = markProtectedSenders(messages as Array<{ uid?: string | null; auth_uid?: string | null }>, reportsOwnerId);
    const protectedDmMessages = markProtectedSenders(dmMessages as Array<{ uid?: string | null; auth_uid?: string | null }>, reportsOwnerId);
    const hydratedUnifiedPage = unifiedPage && reportsChannel
      ? {
          ...unifiedPage,
          items: await hydrateUnifiedReportTimeline(
            unifiedPage.items,
            env,
            reportsOwnerLocale,
          ),
        }
      : unifiedPage;
    const protectedUnifiedTimeline = hydratedUnifiedPage
      ? serializeUnifiedTimelinePage({
          ...hydratedUnifiedPage,
          items: markProtectedSenders(hydratedUnifiedPage.items, reportsOwnerId),
        })
      : null;

    routeStage = "build_response";

    return Response.json({
      channel: safeChannel,
      hasPasscode: Boolean((channel as any).passcode),
      passcodeHint: (channel as any).passcode_hint || "",
      ...(protectedUnifiedTimeline
        ? { unifiedTimeline: protectedUnifiedTimeline }
        : {
            messages: protectedMessages,
            page_start_cursor: messagePage?.pageStartCursor
              ? { id: messagePage.pageStartCursor.id, created_at: messagePage.pageStartCursor.createdAt }
              : null,
            page_end_cursor: messagePage?.pageEndCursor
              ? { id: messagePage.pageEndCursor.id, created_at: messagePage.pageEndCursor.createdAt }
              : null,
            dm: protectedDmMessages || [],
          }),
      blocked,
      viewerBlocked,
      viewerModerationStatus,
      adminDataStatus,
      viewerAccess: isOwner ? "owner" : "standard",
      isReportsChannel: reportsChannel,
      unifiedTimelineEnabled: responseUnifiedTimelineEnabled,
      bannerNotice: config.get(`notice_${channelId}`) || "",
      welcomeConfig: config.get(`welcome_${parentChannelId}`) || "",
      live: liveStatus,
      emojiPresets: config.get(`liveEmojis_${parentChannelId}`) || null,
      petitionEnabled: config.get(`petition_${parentChannelId}`) !== "false",
      dmEnabled: config.get(`dm_${parentChannelId}`) !== "false",
      ownerModeration: ownerModeration
        ? {
            status: ownerModeration.status,
            petitionStatus: ownerModeration.petition_status,
          }
        : undefined,
      roomToken: ownerRoomToken,
      anonymousUid: anonymousIdentity.uid,
      anonymousToken: anonymousIdentity.token,
      deviceToken: deviceIdentity.token,
    });
  } catch (error) {
    throw withOperationalErrorContext(error, {
      route_stage: routeStage,
      request_channel_id: channelId,
      channel_id: parentChannelId,
      live_channel: isLiveChannel,
    });
  }
}
