import { Env } from "../types";
import { createAnonymousIdentity, createDeviceIdentity, verifyAnonymousIdentityToken, verifyDeviceIdentityToken } from "../lib/anonymous-identity";
import { getBlockedDeviceLookup } from "../lib/actor-identities";
import { getChannelModeration, getUserLocale } from "../lib/channel-moderation";
import { endLiveSession, isLiveSessionExpired, parseLiveSessionState, type LiveSessionState } from "../lib/live-sessions";
import { withOperationalErrorContext } from "../lib/operational-events";
import { getReportsChannelId, getReportsChannelOwnerId, isReportsChannel, isReportsChannelOwner } from "../lib/special-channels";
import { readVisibleMessagePage } from "../lib/visible-messages";
import { readDmThreads } from "../lib/dm-threads";
import { isUnifiedTimelineClientEnabled } from "../lib/unified-timeline-rollout";
import { hydrateReportInboxMessages } from "./channel-reports";
import { authorizeRoomToken, createRoomToken } from "./passcode";

function markProtectedSenders<T extends { uid?: string | null; auth_uid?: string | null }>(rows: T[], protectedUid: string | null): Array<T & { protected_sender?: boolean }> {
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
  let routeStage = "load_channel";

  try {
    // Fetch channel config (always from parent)
    const channel = await env.DB.prepare(
      `SELECT channels.*, users.name AS owner_name
       FROM channels
       LEFT JOIN users ON users.id = channels.owner_uid
       WHERE channels.id = ?`
    )
      .bind(parentChannelId).first();

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
    const isReportsOwnerViewer = !isOwner && await isReportsChannelOwner(trustedUserId, env);
    const adminDataStatus = userId === (channel as any).owner_uid
      ? (isOwner ? "authorized" : "unauthorized")
      : undefined;
    if (isReportsChannel(parentChannelId, env) && !isOwner) {
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
      if (!isOwner && !isReportsOwnerViewer) {
        const token = request.headers.get("X-Room-Token");
        if (token) {
          const decoded = await authorizeRoomToken(token, parentChannelId, (channel as any).passcode, env);
          if (!decoded) {
            return Response.json({
              hasPasscode: true,
              passcodeHint: (channel as any).passcode_hint || "",
              channel: { id: (channel as any).id, name: (channel as any).name, profile_image: (channel as any).profile_image, bubble_color: (channel as any).bubble_color },
              anonymousUid: anonymousIdentity.uid,
              anonymousToken: anonymousIdentity.token,
              deviceToken: deviceIdentity.token,
            });
          }
        } else {
          return Response.json({
            hasPasscode: true,
            passcodeHint: (channel as any).passcode_hint || "",
            channel: { id: (channel as any).id, name: (channel as any).name, profile_image: (channel as any).profile_image, bubble_color: (channel as any).bubble_color },
            anonymousUid: anonymousIdentity.uid,
            anonymousToken: anonymousIdentity.token,
            deviceToken: deviceIdentity.token,
          });
        }
      }
      // Owner or valid token — continue to full data
    }

    routeStage = "prepare_bootstrap_batch";

    // Collect independent reads into one D1 batch. This removes the accumulated
    // latency of issuing messages, settings and moderation queries one by one.
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        SELECT id, text, updated_at FROM config
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
      env.DB.prepare("SELECT status FROM channel_moderation WHERE channel_id = ? LIMIT 1").bind(parentChannelId),
    ];
    const reportsChannelId = getReportsChannelId(env);
    const ownerChannelCountIndex = statements.length;
    statements.push(
      env.DB.prepare(`
        SELECT id
        FROM channels
        WHERE owner_uid = ?
          AND show_on_profile = 1
          AND id NOT LIKE '%_live'
          ${reportsChannelId ? "AND id != ?" : ""}
        LIMIT 2
      `).bind(
        (channel as { owner_uid: string }).owner_uid,
        ...(reportsChannelId ? [reportsChannelId] : []),
      )
    );

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

    const [messagePage, batchResults, dmMessages] = await Promise.all([
      readVisibleMessagePage(env, channelId, { limit: 50 }),
      env.DB.batch(statements),
      readDmThreads(
        env,
        channelId,
        isOwner
          ? { owner: true }
          : { owner: false, anonymousUid: anonymousIdentity.uid },
      ),
    ]);

    const rawMessages = messagePage.messages;
    const configRows = (batchResults[0].results || []) as { id: string; text: string; updated_at?: string | null }[];
    const config = new Map(configRows.map((row) => [row.id, row.text]));
    const liveRow = batchResults[1].results?.[0] as { is_frozen?: number } | undefined;
    const moderationRow = batchResults[2].results?.[0] as { status?: string } | undefined;
    const ownerChannelCount = Math.min(
      batchResults[ownerChannelCountIndex].results?.length || 0,
      2,
    );
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

    routeStage = "finalize_channel_state";

    // For live channels, override is_frozen with the _live row's value
    let responseChannel = channel;
    if (isLiveChannel && liveRow) {
      responseChannel = { ...channel, is_frozen: liveRow.is_frozen ?? 0 };
    }
    const viewerModerationStatus = !isOwner
      && !isReportsOwnerViewer
      && moderationRow?.status === "frozen"
        ? "frozen"
        : null;

    // The passcode column contains the stored credential hash. Clients only
    // need to know whether a gate exists, never the hash itself.
    const safeChannel = { ...(responseChannel as Record<string, unknown>) };
    delete safeChannel.passcode;
    safeChannel.owner_channel_count = ownerChannelCount;

    const ownerRoomToken = isOwner && (channel as any).passcode
      ? await createRoomToken(parentChannelId, (channel as any).passcode, env)
      : undefined;
    const ownerModeration = isOwner
      ? await getChannelModeration(parentChannelId, env)
      : null;
    const reportsOwnerId = await getReportsChannelOwnerId(env);
    const reportsOwnerLocale = isOwner
      ? await getUserLocale(trustedUserId, env)
      : "ko";
    const messages = isReportsChannel(parentChannelId, env) && isOwner
      ? await hydrateReportInboxMessages(rawMessages as Array<{ id: string }>, env, reportsOwnerLocale)
      : rawMessages;
    const protectedMessages = markProtectedSenders(messages as Array<{ uid?: string | null; auth_uid?: string | null }>, reportsOwnerId);
    const protectedDmMessages = markProtectedSenders(dmMessages as Array<{ uid?: string | null; auth_uid?: string | null }>, reportsOwnerId);

    routeStage = "build_response";

    return Response.json({
      channel: safeChannel,
      hasPasscode: Boolean((channel as any).passcode),
      passcodeHint: (channel as any).passcode_hint || "",
      messages: protectedMessages,
      page_start_cursor: messagePage.pageStartCursor
        ? { id: messagePage.pageStartCursor.id, created_at: messagePage.pageStartCursor.createdAt }
        : null,
      page_end_cursor: messagePage.pageEndCursor
        ? { id: messagePage.pageEndCursor.id, created_at: messagePage.pageEndCursor.createdAt }
        : null,
      blocked,
      viewerBlocked,
      viewerModerationStatus,
      dm: protectedDmMessages || [],
      adminDataStatus,
      viewerAccess: isOwner ? "owner" : isReportsOwnerViewer ? "reports_owner" : "standard",
      isReportsChannel: isReportsChannel(parentChannelId, env),
      unifiedTimelineEnabled: isUnifiedTimelineClientEnabled(env, parentChannelId, {
        live: isLiveChannel,
        reports: isReportsChannel(parentChannelId, env),
      }),
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
