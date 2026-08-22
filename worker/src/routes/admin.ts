import { Env } from "../types";
import { getChannelModeration, getReportsChannelOwner, getUserLocale, isOwnerModerationBlocked, postReportsInboxMessage, setChannelModeration, type UserLocale } from "../lib/channel-moderation";
import { deleteMediaByUrl, extractMediaKey, normalizeManagedMediaUrl } from "../lib/media";
import { deleteUploadTicketByAttachment } from "../lib/upload-tickets";
import { createLiveSessionState, endLiveSession } from "../lib/live-sessions";
import { getReportsChannelOwnerId } from "../lib/special-channels";
import { getChannelAppearanceVersion } from "../lib/channel-appearance";
import { invalidateBannedWordsCache, invalidatePasscodeCache } from "../lib/validation";
import { hashBlockedDeviceId, resolveActorIdentity, type ActorRecordType } from "../lib/actor-identities";
import { createPasscodeHash } from "./passcode";
import { queueChannelNotification } from "../lib/notification-events";
import { isTrustedInternalRequest } from "../lib/trusted-identity";
import { deleteChannel } from "../lib/channel-cleanup";
import {
  stageDmDeletion,
  stageDmReplyDeletion,
  stageMessageDeletion,
  undoPendingDeletion,
} from "../lib/pending-admin-deletions";

function normalizeBubbleColor(value: unknown): unknown {
  return typeof value === "string" && value.toLowerCase() === "#3b8df0"
    ? "#3598fe"
    : value;
}

function isAllowedBackgroundImageUrl(
  value: unknown,
  env: Env,
): boolean {
  if (typeof value !== "string") return false;
  if (value.startsWith("/api/media/")) {
    return !/["'\\\s]/.test(value);
  }

  try {
    const imageUrl = new URL(value);
    if (!imageUrl.pathname.startsWith("/api/media/")) return false;
    const appOrigin = new URL(env.APP_ORIGIN);
    return (
      imageUrl.origin === appOrigin.origin
      || imageUrl.hostname === "letsplay-api.letmetellu.workers.dev"
      || imageUrl.hostname === "localhost"
      || imageUrl.hostname === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

async function isProtectedAdminSender(input: {
  env: Env;
  uid: string | null;
  authUid: string | null;
}): Promise<boolean> {
  if (input.uid === "system-moderation") return true;
  const reportsOwnerId = await getReportsChannelOwnerId(input.env);
  if (!reportsOwnerId) return false;
  return input.uid === reportsOwnerId || input.authUid === reportsOwnerId;
}

function formatModerationPetitionMessage(input: {
  petitionId: string;
  channelId: string;
  channelName: string;
  channelUrl: string;
  ownerLabel: string;
  text: string;
  createdAt: string;
  locale: UserLocale;
}) {
  return input.locale === "en"
    ? [
        "📝 Channel appeal",
        `Appeal ID: ${input.petitionId}`,
        `Channel: ${input.channelName} (${input.channelUrl})`,
        `Submitted by: ${input.ownerLabel}`,
        `Submitted at: ${input.createdAt}`,
        `Details: ${input.text}`,
        "Status: Open",
      ].join("\n")
    : [
        "📝 채널 이의 제기",
        `이의 제기 ID: ${input.petitionId}`,
        `채널: ${input.channelName} (${input.channelUrl})`,
        `제출자: ${input.ownerLabel}`,
        `접수 시각: ${input.createdAt}`,
        `내용: ${input.text}`,
        "상태: 접수됨",
      ].join("\n");
}

export async function handleAdmin(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  // Verify internal token (sent by Vercel after session check)
  if (!isTrustedInternalRequest(request, env)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = request.headers.get("X-User-Id");
  if (!userId) {
    return Response.json({ error: "missing user id" }, { status: 400 });
  }

  const body = await request.json() as { action: string; channel_id: string; payload?: Record<string, unknown> };
  const { action, channel_id, payload } = body;

  // These actions do not target an existing owned channel.
  if (action !== "create-channel" && action !== "channel-capacity") {
    const channel = await env.DB.prepare("SELECT owner_uid FROM channels WHERE id = ?")
      .bind(channel_id).first();
    if (!channel || channel.owner_uid !== userId) {
      return Response.json({ error: "not owner" }, { status: 403 });
    }

    const moderation = await getChannelModeration(channel_id, env);
    if (isOwnerModerationBlocked(moderation) && action !== "submit-moderation-petition") {
      return Response.json({ error: "owner_suspended" }, { status: 403 });
    }
  }

  switch (action) {
    case "channel-capacity": {
      const row = await env.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM channels
        WHERE id NOT LIKE '%_live'
      `).first<{ count: number }>();
      const count = Number(row?.count || 0);
      return Response.json({ count, limit: 50, can_create: count < 50 });
    }

    case "create-channel": {
      const { name } = payload || {};
      const instanceId = crypto.randomUUID();
      // channel_id is the slug, userId is the owner
      const existing = await env.DB.prepare("SELECT id FROM channels WHERE id = ?").bind(channel_id).first();
      if (existing) return Response.json({ error: "channel already exists" }, { status: 409 });

      const result = await env.DB.prepare(`
        INSERT INTO channels (id, owner_uid, name, instance_id, show_on_profile, bubble_color)
        SELECT ?, ?, ?, ?, 0, '#3598fe'
        WHERE (
          SELECT COUNT(*)
          FROM channels
          WHERE owner_uid = ? AND id NOT LIKE '%_live'
        ) < 5
        AND (
          SELECT COUNT(*)
          FROM channels
          WHERE id NOT LIKE '%_live'
        ) < 50
      `).bind(channel_id, userId, name || "My Channel", instanceId, userId).run();
      if (!result.meta.changes) {
        const counts = await env.DB.prepare(`
          SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN owner_uid = ? THEN 1 ELSE 0 END) AS owner_count
          FROM channels
          WHERE id NOT LIKE '%_live'
        `).bind(userId).first<{ total_count: number; owner_count: number }>();
        if (Number(counts?.total_count || 0) >= 50) {
          return Response.json({ error: "beta channel limit reached" }, { status: 403 });
        }
        return Response.json({ error: "channel limit reached" }, { status: 403 });
      }

      return Response.json({ ok: true, channel_id });
    }

    case "delete-channel": {
      const result = await deleteChannel(channel_id, env);
      return Response.json({
        ok: true,
        cleanup_pending: result.cleanupPending,
      });
    }

    case "submit-moderation-petition": {
      const petitionText = typeof payload?.text === "string" ? payload.text.trim().slice(0, 500) : "";
      if (!petitionText) {
        return Response.json({ error: "petition_required" }, { status: 400 });
      }

      const moderation = await getChannelModeration(channel_id, env);
      if (!isOwnerModerationBlocked(moderation)) {
        return Response.json({ error: "petition_unavailable" }, { status: 409 });
      }
      if (moderation.petition_status !== "none") {
        return Response.json({ error: "petition_exists" }, { status: 409 });
      }

      const channel = await env.DB.prepare("SELECT id, name, owner_uid FROM channels WHERE id = ?")
        .bind(channel_id)
        .first<{ id: string; name: string; owner_uid: string }>();
      if (!channel || channel.owner_uid !== userId) {
        return Response.json({ error: "not owner" }, { status: 403 });
      }

      const ownerProfile = await env.DB.prepare("SELECT name FROM users WHERE id = ?")
        .bind(userId)
        .first<{ name: string | null }>();
      const reportsChannel = await getReportsChannelOwner(env);
      const reportsOwnerLocale = reportsChannel
        ? await getUserLocale(reportsChannel.owner_uid, env)
        : "ko";
      const petitionId = crypto.randomUUID();
      const inboxMessageId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const ownerLabel = ownerProfile?.name?.trim()
        ? reportsOwnerLocale === "en"
          ? `${ownerProfile.name.trim()} Admin`
          : `${ownerProfile.name.trim()} 관리자`
        : reportsOwnerLocale === "en"
          ? `Channel Admin #${userId.slice(-6)}`
          : `채널 관리자 #${userId.slice(-6)}`;
      const petitionMeta = {
        petition_id: petitionId,
        channel_id: channel_id,
        channel_name: channel.name,
        channel_url: `${env.APP_ORIGIN.replace(/\/$/, "")}/ch/${encodeURIComponent(channel_id)}`,
        owner_label: ownerLabel,
        text: petitionText,
        status: "open",
        created_at: createdAt,
        resolved_at: null,
        resolution_note: null,
      };
      const petitionMessage = formatModerationPetitionMessage({
        petitionId,
        channelId: channel_id,
        channelName: channel.name,
        channelUrl: petitionMeta.channel_url,
        ownerLabel,
        text: petitionText,
        createdAt,
        locale: reportsOwnerLocale,
      });

      await env.DB.prepare(`
        INSERT INTO channel_petitions (
          id, channel_id, owner_uid, text, status, created_at, inbox_message_id
        ) VALUES (?, ?, ?, ?, 'open', ?, ?)
      `).bind(
        petitionId,
        channel_id,
        userId,
        petitionText,
        createdAt,
        inboxMessageId,
      ).run();

      await setChannelModeration(channel_id, {
        status: "frozen",
        petition_status: "open",
        current_petition_id: petitionId,
      }, env);

      await postReportsInboxMessage({
        env,
        id: inboxMessageId,
        createdAt,
        nick: reportsOwnerLocale === "en" ? "Appeal" : "이의 제기",
        text: petitionMessage,
        extra: {
          petition_meta: petitionMeta,
        },
      });

      return Response.json({ ok: true, petition_id: petitionId, created_at: createdAt });
    }

    case "freeze": {
      const frozen = payload?.frozen ? 1 : 0;
      await env.DB.prepare("UPDATE channels SET is_frozen = ? WHERE id = ?")
        .bind(frozen, channel_id).run();

      // Broadcast freeze change to parent channel DO (where clients connect)
      const freezeBroadcastChannel = channel_id.endsWith("_live") ? channel_id.replace(/_live$/, "") : channel_id;
      const doId = env.CHAT_ROOM.idFromName(freezeBroadcastChannel);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "freeze-change", frozen: !!payload?.frozen, live: channel_id.endsWith("_live"), moderation: false }),
      }));

      return Response.json({ ok: true });
    }

    case "block": {
      const reason = typeof payload?.reason === "string" ? payload.reason : "";
      const messageId = typeof payload?.message_id === "string" ? payload.message_id : "";
      const messageKind = payload?.message_kind === "dm" ? "dm" : "message";
      let uid = typeof payload?.uid === "string" ? payload.uid : "";
      let authUid: string | null = null;
      let deviceId: string | null = typeof payload?.device_id === "string" && payload.device_id
        ? await hashBlockedDeviceId(payload.device_id, env)
        : null;

      if (messageId) {
        const resolved = await resolveActorIdentity({
          env,
          recordId: messageId,
          recordType: messageKind as ActorRecordType,
          channelId: channel_id,
        });
        if (resolved) {
          uid = resolved.uid;
          deviceId = resolved.deviceIdHash;
        } else {
          const liveChannelId = `${channel_id}_live`;
          const fallbackRow = messageKind === "dm"
            ? await env.DB.prepare(
              "SELECT uid, auth_uid FROM dm WHERE id = ? AND channel_id IN (?, ?) LIMIT 1"
            ).bind(messageId, channel_id, liveChannelId).first<{ uid: string; auth_uid: string | null }>()
            : await env.DB.prepare(
              "SELECT uid, auth_uid FROM messages WHERE id = ? AND channel_id IN (?, ?) LIMIT 1"
            ).bind(messageId, channel_id, liveChannelId).first<{ uid: string; auth_uid: string | null }>();
          if (!fallbackRow?.uid) {
            return Response.json({ error: "identity_not_found" }, { status: 404 });
          }
          uid = fallbackRow.uid;
          authUid = fallbackRow.auth_uid || null;
          deviceId = null;
        }
      }

      if (!uid) {
        return Response.json({ error: "missing required fields" }, { status: 400 });
      }

      if (await isProtectedAdminSender({ env, uid, authUid })) {
        return Response.json({ error: "cannot_block_platform_admin" }, { status: 403 });
      }

      await env.DB.batch([
        env.DB.prepare("DELETE FROM blocked WHERE uid = ? AND channel_id = ?")
          .bind(uid, channel_id),
        env.DB.prepare(
          "INSERT INTO blocked (id, uid, reason, device_id, channel_id) VALUES (?, ?, ?, ?, ?)"
        ).bind(crypto.randomUUID(), uid, reason, deviceId, channel_id),
      ]);

      // Broadcast block so the blocked user's UI updates immediately
      const blockDoId = env.CHAT_ROOM.idFromName(channel_id);
      const blockStub = env.CHAT_ROOM.get(blockDoId);
      await blockStub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "user-blocked", uid, device_id: deviceId }),
      }));

      return Response.json({ ok: true });
    }

    case "unblock": {
      const { uid: unblockUid } = payload || {};
      const blockedEntry = await env.DB.prepare(
        "SELECT COALESCE(device_id, fingerprint) AS device_id FROM blocked WHERE uid = ? AND channel_id = ? LIMIT 1"
      ).bind(unblockUid, channel_id).first();
      await env.DB.prepare("DELETE FROM blocked WHERE uid = ? AND channel_id = ?")
        .bind(unblockUid, channel_id).run();
      // Clean up old petition DMs from this user
      const petitionRows = await env.DB.prepare(`
        SELECT dm.id, dm.image
        FROM dm
        WHERE dm.uid = ? AND dm.channel_id = ? AND dm.text LIKE '[이의 제기]%'
      `).bind(unblockUid, channel_id).all<{ id: string; image: string | null }>();
      const petitionIds = (petitionRows.results || []).map((row) => row.id);
      const petitionReplies = petitionIds.length > 0
        ? await env.DB.prepare(`
            SELECT id, image
            FROM dm_replies
            WHERE dm_id IN (${petitionIds.map(() => "?").join(", ")})
          `).bind(...petitionIds).all<{ id: string; image: string | null }>()
        : { results: [] as Array<{ id: string; image: string | null }> };
      await env.DB.batch([
        env.DB.prepare(`
          DELETE FROM dm_replies
          WHERE dm_id IN (
            SELECT id FROM dm
            WHERE uid = ? AND channel_id = ? AND text LIKE '[이의 제기]%'
          )
        `).bind(unblockUid, channel_id),
        env.DB.prepare("DELETE FROM dm WHERE uid = ? AND channel_id = ? AND text LIKE '[이의 제기]%'")
          .bind(unblockUid, channel_id),
      ]);
      await Promise.all([
        ...(petitionRows.results || []).map((row) => deleteMediaByUrl(env, row.image)),
        ...(petitionRows.results || []).map((row) => deleteUploadTicketByAttachment(env, "dm", row.id)),
        ...(petitionReplies.results || []).map((row) => deleteMediaByUrl(env, row.image)),
        ...(petitionReplies.results || []).map((row) => deleteUploadTicketByAttachment(env, "dm", row.id)),
      ]);
      // Clean up old report messages about this user
      await env.DB.prepare("DELETE FROM messages WHERE uid = ? AND channel_id = ? AND report = 1")
        .bind(unblockUid, channel_id).run();

      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({
          type: "user-unblocked",
          uid: unblockUid,
          device_id: (blockedEntry as { device_id?: string | null } | null)?.device_id || null,
        }),
      }));
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "messages-sync", channel_id }),
      }));

      return Response.json({ ok: true });
    }

    case "delete-message": {
      const { message_id } = payload || {};
      if (typeof message_id !== "string" || !message_id) {
        return Response.json({ error: "missing message id" }, { status: 400 });
      }
      const pending = await stageMessageDeletion(env, channel_id, userId, message_id);
      if (!pending) return Response.json({ error: "message not found" }, { status: 404 });

      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "message-deleted", message_id, soft: false }),
      }));

      return Response.json({
        ok: true,
        deletion_id: pending.deletionId,
        undo_expires_at: pending.expiresAt,
      });
    }

    case "delete-dm": {
      const { dm_id } = payload || {};
      if (typeof dm_id !== "string" || !dm_id) {
        return Response.json({ error: "missing dm id" }, { status: 400 });
      }
      const pending = await stageDmDeletion(env, channel_id, userId, dm_id);
      if (!pending) return Response.json({ error: "dm not found" }, { status: 404 });

      const doId2 = env.CHAT_ROOM.idFromName(channel_id);
      const stub2 = env.CHAT_ROOM.get(doId2);
      await stub2.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "dm-deleted", dm_id }),
      }));
      await stub2.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "dm-threads-changed" }),
      }));

      return Response.json({
        ok: true,
        deletion_id: pending.deletionId,
        undo_expires_at: pending.expiresAt,
      });
    }

    case "delete-dm-reply": {
      const { reply_id } = payload || {};
      if (typeof reply_id !== "string" || !reply_id) {
        return Response.json({ error: "missing reply id" }, { status: 400 });
      }
      const pending = await stageDmReplyDeletion(env, channel_id, userId, reply_id);
      if (!pending) return Response.json({ error: "dm reply not found" }, { status: 404 });

      const chatRoom = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(channel_id));
      await chatRoom.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "dm-threads-changed" }),
      }));
      return Response.json({
        ok: true,
        deletion_id: pending.deletionId,
        undo_expires_at: pending.expiresAt,
      });
    }

    case "undo-delete": {
      const { deletion_id } = payload || {};
      if (typeof deletion_id !== "string" || !deletion_id) {
        return Response.json({ error: "missing deletion id" }, { status: 400 });
      }
      const restored = await undoPendingDeletion(env, channel_id, userId, deletion_id);
      if (!restored) {
        return Response.json({ error: "undo window expired" }, { status: 409 });
      }

      const chatRoom = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(channel_id));
      await chatRoom.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({
          type: restored.recordType === "message" ? "messages-sync" : "dm-threads-changed",
          channel_id,
        }),
      }));
      return Response.json({ ok: true });
    }

    case "update-profile": {
      const {
        name,
        profile_image,
        bubble_color,
        show_on_profile,
        background_type,
        background_color,
        background_image,
        background_overlay,
        background_blur,
      } = payload || {};
      const updates: string[] = [];
      const values: unknown[] = [];
      const hasAppearanceUpdate = (
        bubble_color !== undefined
        || background_type !== undefined
        || background_color !== undefined
        || background_image !== undefined
        || background_overlay !== undefined
        || background_blur !== undefined
      );
      let previousBackgroundImage: string | null = null;
      let normalizedBackgroundImage: string | null | undefined;
      const normalizedBubbleColor = normalizeBubbleColor(bubble_color);
      const currentAppearance = hasAppearanceUpdate
        ? await env.DB.prepare(
            `SELECT bubble_color, background_type, background_color, background_image,
                    background_overlay, background_blur
             FROM channels
             WHERE id = ?`
          ).bind(channel_id).first<{
            bubble_color: string | null;
            background_type: "default" | "color" | "image" | null;
            background_color: string | null;
            background_image: string | null;
            background_overlay: number | null;
            background_blur: number | null;
          }>()
        : null;

      if (name !== undefined) { updates.push("name = ?"); values.push(name); }
      if (profile_image !== undefined) { updates.push("profile_image = ?"); values.push(profile_image); }
      if (bubble_color !== undefined) {
        updates.push("bubble_color = ?");
        values.push(normalizedBubbleColor);
      }
      if (show_on_profile !== undefined) {
        updates.push("show_on_profile = ?");
        values.push(show_on_profile === true ? 1 : 0);
      }
      if (background_type !== undefined) {
        if (typeof background_type !== "string" || !["default", "color", "image"].includes(background_type)) {
          return Response.json({ error: "invalid background type" }, { status: 400 });
        }
        updates.push("background_type = ?");
        values.push(background_type);
      }
      if (background_color !== undefined) {
        if (background_color !== null && (typeof background_color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(background_color))) {
          return Response.json({ error: "invalid background color" }, { status: 400 });
        }
        updates.push("background_color = ?");
        values.push(background_color);
      }
      if (background_image !== undefined) {
        previousBackgroundImage = currentAppearance?.background_image || null;
        if (background_image !== null) {
          if (typeof background_image !== "string") {
            return Response.json({ error: "invalid background image" }, { status: 400 });
          }
          normalizedBackgroundImage = normalizeManagedMediaUrl(background_image);
          if (!normalizedBackgroundImage || !isAllowedBackgroundImageUrl(background_image, env)) {
            return Response.json({ error: "invalid background image" }, { status: 400 });
          }
        } else {
          normalizedBackgroundImage = null;
        }
        updates.push("background_image = ?");
        values.push(normalizedBackgroundImage);
      }
      if (background_overlay !== undefined) {
        const overlay = Number(background_overlay);
        if (!Number.isInteger(overlay) || overlay < 0 || overlay > 60) {
          return Response.json({ error: "invalid background overlay" }, { status: 400 });
        }
        updates.push("background_overlay = ?");
        values.push(overlay);
      }
      if (background_blur !== undefined) {
        if (background_blur !== true && background_blur !== false && background_blur !== 1 && background_blur !== 0) {
          return Response.json({ error: "invalid background blur" }, { status: 400 });
        }
        updates.push("background_blur = ?");
        values.push(background_blur === true || background_blur === 1 ? 1 : 0);
      }
      const appearanceVersion = hasAppearanceUpdate
        ? getChannelAppearanceVersion({
            bubble_color: bubble_color !== undefined
              ? normalizedBubbleColor as string | null | undefined
              : currentAppearance?.bubble_color,
            background_type: background_type !== undefined
              ? background_type as "default" | "color" | "image"
              : currentAppearance?.background_type || undefined,
            background_color: background_color !== undefined
              ? background_color as string | null
              : currentAppearance?.background_color,
            background_image: background_image !== undefined
              ? normalizedBackgroundImage
              : currentAppearance?.background_image,
            background_overlay: background_overlay !== undefined
              ? Number(background_overlay)
              : currentAppearance?.background_overlay,
            background_blur: background_blur !== undefined
              ? background_blur as number | boolean | null
              : currentAppearance?.background_blur,
          })
        : undefined;

      if (updates.length > 0) {
        values.push(channel_id);
        await env.DB.prepare(`UPDATE channels SET ${updates.join(", ")} WHERE id = ?`)
          .bind(...values).run();

        const doId = env.CHAT_ROOM.idFromName(channel_id);
        const stub = env.CHAT_ROOM.get(doId);
        await stub.fetch(new Request("http://internal/broadcast", {
          method: "POST",
          body: JSON.stringify({
            type: "profile-change",
            channel_id,
            name,
            profile_image,
            bubble_color: normalizedBubbleColor,
            appearance_version: appearanceVersion,
            show_on_profile,
            background_type,
            background_color,
            background_image: normalizedBackgroundImage,
            background_overlay,
            background_blur,
          }),
        }));

        const previousBackgroundKey = extractMediaKey(previousBackgroundImage);
        const nextBackgroundKey = extractMediaKey(normalizedBackgroundImage);
        if (
          background_image !== undefined
          && previousBackgroundKey
          && previousBackgroundKey !== nextBackgroundKey
        ) {
          await env.MEDIA.delete(previousBackgroundKey).catch(() => {});
        }
      }

      return Response.json({ ok: true });
    }

    case "set-notice": {
      const { text } = payload || {};
      const noticeText = (text as string) || "";
      if (noticeText) {
        try {
          const parsed = JSON.parse(noticeText) as { title?: unknown; body?: unknown };
          if (
            typeof parsed.title !== "string"
            || parsed.title.length > 100
            || (parsed.body !== undefined && (typeof parsed.body !== "string" || parsed.body.length > 1000))
          ) {
            return Response.json({ error: "notice_too_long" }, { status: 400 });
          }
        } catch {
          // Backward-compatible title-only notices.
          if (noticeText.length > 1000) {
            return Response.json({ error: "notice_too_long" }, { status: 400 });
          }
        }
      }
      // Upsert into config table
      await env.DB.prepare(
        "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
      ).bind(`notice_${channel_id}`, noticeText, channel_id, noticeText).run();

      // Broadcast notice change to parent channel DO (where clients connect)
      const isLive = channel_id.endsWith("_live");
      const broadcastChannel = isLive ? channel_id.replace(/_live$/, "") : channel_id;
      const doId = env.CHAT_ROOM.idFromName(broadcastChannel);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "notice-changed", channel_id, notice: noticeText, live: isLive }),
      }));

      return Response.json({ ok: true });
    }

    case "set-rules": {
      const { rules } = payload || {};
      const rulesText = (rules as string) || "[]";
      await env.DB.prepare("UPDATE channels SET notice = ? WHERE id = ?")
        .bind(rulesText, channel_id).run();

      // Broadcast rules change so non-admin sees the ℹ️ icon appear/disappear
      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "rules-changed", rules: rulesText }),
      }));

      return Response.json({ ok: true });
    }

    case "add-banned-word": {
      const { word, expires } = payload || {};
      if (!word) return Response.json({ error: "missing word" }, { status: 400 });
      await env.DB.prepare(
        "INSERT INTO banned_words (id, word, channel_id, expires) VALUES (?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), word, channel_id, expires || null).run();
      invalidateBannedWordsCache(channel_id);
      return Response.json({ ok: true });
    }

    case "remove-banned-word": {
      const { word } = payload || {};
      if (!word) return Response.json({ error: "missing word" }, { status: 400 });
      await env.DB.prepare("DELETE FROM banned_words WHERE word = ? AND channel_id = ?")
        .bind(word, channel_id).run();
      invalidateBannedWordsCache(channel_id);
      return Response.json({ ok: true });
    }

    case "set-welcome": {
      const { config } = payload || {};
      if (typeof config !== "string" || config.length > 20_000) {
        return Response.json({ error: "invalid welcome config" }, { status: 400 });
      }
      try {
        const parsed = JSON.parse(config);
        if (
          typeof parsed.icon === "string"
          && (parsed.icon.startsWith("blob:") || parsed.icon.startsWith("data:"))
        ) {
          return Response.json({ error: "temporary image URL not allowed" }, { status: 400 });
        }
      } catch {
        return Response.json({ error: "invalid welcome config" }, { status: 400 });
      }
      await env.DB.prepare(
        "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
      ).bind(`welcome_${channel_id}`, config || "", channel_id, config || "").run();
      return Response.json({ ok: true });
    }

    case "set-passcode": {
      const { passcode, hint } = payload || {};
      const normalizedHint = typeof hint === "string" ? hint.trim() : "";
      if (normalizedHint.length > 200) {
        return Response.json({ error: "passcode hint too long" }, { status: 400 });
      }
      let hashedPasscode: string | null = null;
      if (passcode && (passcode as string).trim()) {
        hashedPasscode = await createPasscodeHash(passcode as string);
      }
      // Hints are intentionally public on the locked-channel screen. Clear the
      // hint whenever the passcode itself is removed.
      await env.DB.prepare("UPDATE channels SET passcode = ?, passcode_hint = ? WHERE id = ?")
        .bind(hashedPasscode, hashedPasscode ? normalizedHint || null : null, channel_id).run();
      invalidatePasscodeCache(channel_id);
      const passcodeDoId = env.CHAT_ROOM.idFromName(channel_id);
      const passcodeStub = env.CHAT_ROOM.get(passcodeDoId);
      await passcodeStub.fetch(new Request("http://internal/access-policy-changed", {
        method: "POST",
        body: JSON.stringify({ passcode: hashedPasscode }),
      }));
      return Response.json({ ok: true });
    }

    case "set-petition": {
      const { enabled } = payload || {};
      await env.DB.prepare(
        "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
      ).bind(`petition_${channel_id}`, enabled ? "true" : "false", channel_id, enabled ? "true" : "false").run();
      const petDoId = env.CHAT_ROOM.idFromName(channel_id);
      const petStub = env.CHAT_ROOM.get(petDoId);
      await petStub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "petition-changed", enabled: !!enabled }),
      }));
      return Response.json({ ok: true });
    }

    case "set-dm": {
      const { enabled } = payload || {};
      await env.DB.prepare(
        "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
      ).bind(`dm_${channel_id}`, enabled ? "true" : "false", channel_id, enabled ? "true" : "false").run();
      const dmDoId = env.CHAT_ROOM.idFromName(channel_id);
      const dmStub = env.CHAT_ROOM.get(dmDoId);
      await dmStub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "dm-toggle-changed", enabled: !!enabled }),
      }));
      return Response.json({ ok: true });
    }

    case "set-emoji-presets": {
      const { emojis } = payload || {};
      await env.DB.prepare(
        "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
      ).bind(`liveEmojis_${channel_id}`, emojis || "[]", channel_id, emojis || "[]").run();

      // Broadcast preset change so other clients update their emoji bar
      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "emoji-presets-changed", emojis: emojis || "[]" }),
      }));

      return Response.json({ ok: true });
    }

    case "start-live": {
      const { title } = payload || {};
      const sessionId = crypto.randomUUID();
      const liveSession = createLiveSessionState(
        typeof title === "string" ? title : undefined,
        sessionId,
      );
      const liveState = JSON.stringify(liveSession);

      await env.DB.prepare(
        "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
      ).bind(`live_${channel_id}`, liveState, channel_id, liveState).run();

      // Create a temporary channel entry for the _live channel (FK constraint)
      const liveChannelId = `${channel_id}_live`;
      await env.DB.prepare(
        "INSERT OR IGNORE INTO channels (id, owner_uid, name) VALUES (?, ?, ?)"
      ).bind(liveChannelId, userId, "Live").run();

      // Broadcast live-started to all connected clients
      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({
          type: "live-started",
          channel_id,
          title: liveSession.title,
          sessionId,
          startedAt: liveSession.startedAt,
          expiresAt: liveSession.expiresAt,
        }),
      }));

      if (ctx) {
        ctx.waitUntil(queueChannelNotification({
          env,
          ctx,
          channelId: channel_id,
          event: "live_start",
          eventId: sessionId,
          actorUserId: userId,
          liveTitle: liveSession.title,
          memberImportance: "important",
        }));
      }

      return Response.json({ ok: true, sessionId, live: liveSession });
    }

    case "end-live": {
      const expectedSessionId = typeof payload?.sessionId === "string"
        ? payload.sessionId
        : "";
      if (!expectedSessionId) {
        return Response.json({ error: "missing_live_session_id" }, { status: 400 });
      }
      const result = await endLiveSession(env, channel_id, "manual", expectedSessionId);
      if (result.status === "session_changed") {
        return Response.json({
          error: "live_session_changed",
          live: result.live,
        }, { status: 409 });
      }
      return Response.json({ ok: true, ended: result.status === "ended" });
    }

    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
}
