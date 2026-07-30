import { Env } from "../types";
import { getChannelModeration, getReportsChannelOwner, getUserLocale, isOwnerModerationBlocked, postReportsInboxMessage, setChannelModeration, type UserLocale } from "../lib/channel-moderation";
import { deleteMediaByUrl, extractMediaKey } from "../lib/media";
import { deleteUploadTicketByAttachment } from "../lib/upload-tickets";
import { invalidateBannedWordsCache, invalidatePasscodeCache } from "../lib/validation";
import { hashBlockedDeviceId, resolveActorIdentity, type ActorRecordType } from "../lib/actor-identities";
import { createPasscodeHash, invalidatePasscodeAttempts } from "./passcode";

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

export async function deleteChannel(channelId: string, env: Env) {
  const channelIds = [channelId, `${channelId}_live`];
  const placeholders = channelIds.map(() => "?").join(", ");
  const [messageMedia, galleryMedia, dmMedia, channelMedia, configMedia, uploadTickets] = await Promise.all([
    env.DB.prepare(`SELECT image FROM messages WHERE channel_id IN (${placeholders}) AND image IS NOT NULL`).bind(...channelIds).all(),
    env.DB.prepare(`SELECT image FROM gallery WHERE channel_id IN (${placeholders}) AND image IS NOT NULL`).bind(...channelIds).all(),
    env.DB.prepare(`SELECT image FROM dm WHERE channel_id IN (${placeholders}) AND image IS NOT NULL`).bind(...channelIds).all(),
    env.DB.prepare(`SELECT profile_image, background_image FROM channels WHERE id IN (${placeholders}) AND (profile_image IS NOT NULL OR background_image IS NOT NULL)`).bind(...channelIds).all(),
    env.DB.prepare(`SELECT text FROM config WHERE channel_id IN (${placeholders})`).bind(...channelIds).all(),
    env.DB.prepare(`SELECT key FROM upload_tickets WHERE channel_id IN (${placeholders})`).bind(...channelIds).all(),
  ]);

  const mediaKeys = new Set<string>();
  const mediaSources = [
    ...messageMedia.results.map((row) => row.image),
    ...galleryMedia.results.map((row) => row.image),
    ...dmMedia.results.map((row) => row.image),
    ...channelMedia.results.map((row) => row.profile_image),
    ...channelMedia.results.map((row) => row.background_image),
    ...configMedia.results.map((row) => row.text),
  ];
  for (const source of mediaSources) {
    if (typeof source !== "string") continue;
    for (const match of source.matchAll(/\/api\/media\/([^"'\\\s)<>]+)/g)) {
      if (match[1]) mediaKeys.add(match[1]);
    }
  }
  for (const row of uploadTickets.results || []) {
    if (typeof row.key === "string" && row.key) mediaKeys.add(row.key);
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM messages WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM gallery WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM dm WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM blocked WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM message_actor_identities WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM config WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM moderators WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM banned_words WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM upload_tickets WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM user_recent_channels WHERE channel_id IN (${placeholders})`).bind(...channelIds),
    env.DB.prepare(`DELETE FROM channels WHERE id IN (${placeholders})`).bind(...channelIds),
  ]);
  const doId = env.CHAT_ROOM.idFromName(channelId);
  const stub = env.CHAT_ROOM.get(doId);
  await stub.fetch(new Request("http://internal/channel-deleted", {
    method: "POST",
  })).catch(() => null);
  await Promise.all([...mediaKeys].map((key) => env.MEDIA.delete(key).catch(() => {})));
  invalidatePasscodeCache(channelId);
  invalidateBannedWordsCache(channelId);
  invalidatePasscodeAttempts(channelId);
}

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  // Verify internal token (sent by Vercel after session check)
  const token = request.headers.get("X-Internal-Token");
  if (token !== env.INTERNAL_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = request.headers.get("X-User-Id");
  if (!userId) {
    return Response.json({ error: "missing user id" }, { status: 400 });
  }

  const body = await request.json() as { action: string; channel_id: string; payload?: Record<string, unknown> };
  const { action, channel_id, payload } = body;

  // Skip ownership check for create-channel (channel doesn't exist yet)
  if (action !== "create-channel") {
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
    case "create-channel": {
      const { name } = payload || {};
      const instanceId = crypto.randomUUID();
      // channel_id is the slug, userId is the owner
      const existing = await env.DB.prepare("SELECT id FROM channels WHERE id = ?").bind(channel_id).first();
      if (existing) return Response.json({ error: "channel already exists" }, { status: 409 });

      const result = await env.DB.prepare(`
        INSERT INTO channels (id, owner_uid, name, instance_id, show_on_profile)
        SELECT ?, ?, ?, ?, 0
        WHERE (
          SELECT COUNT(*)
          FROM channels
          WHERE owner_uid = ? AND id NOT LIKE '%_live'
        ) < 5
      `).bind(channel_id, userId, name || "My Channel", instanceId, userId).run();
      if (!result.meta.changes) {
        return Response.json({ error: "channel limit reached" }, { status: 403 });
      }

      return Response.json({ ok: true, channel_id });
    }

    case "delete-channel": {
      await deleteChannel(channel_id, env);
      return Response.json({ ok: true });
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
              "SELECT uid FROM dm WHERE id = ? AND channel_id IN (?, ?) LIMIT 1"
            ).bind(messageId, channel_id, liveChannelId).first<{ uid: string }>()
            : await env.DB.prepare(
              "SELECT uid FROM messages WHERE id = ? AND channel_id IN (?, ?) LIMIT 1"
            ).bind(messageId, channel_id, liveChannelId).first<{ uid: string }>();
          if (!fallbackRow?.uid) {
            return Response.json({ error: "identity_not_found" }, { status: 404 });
          }
          uid = fallbackRow.uid;
          deviceId = null;
        }
      }

      if (!uid) {
        return Response.json({ error: "missing required fields" }, { status: 400 });
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
      await env.DB.prepare("DELETE FROM dm WHERE uid = ? AND channel_id = ? AND text LIKE '[이의 제기]%'")
        .bind(unblockUid, channel_id).run();
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
      const { results: replies } = await env.DB.prepare(
        "SELECT id FROM messages WHERE reply_to = ? AND channel_id = ?"
      ).bind(message_id, channel_id).all<{ id: string }>();
      const { results: mediaRows } = await env.DB.prepare(
        "SELECT image FROM messages WHERE channel_id = ? AND (id = ? OR reply_to = ?) AND image IS NOT NULL"
      ).bind(channel_id, message_id, message_id).all<{ image: string }>();
      const deletedIds = [message_id as string, ...replies.map((reply) => reply.id)];
      const mediaKeys = [...new Set(
        mediaRows
          .map((row) => extractMediaKey(row.image))
          .filter((key): key is string => Boolean(key))
      )];
      const mappingPlaceholders = deletedIds.map(() => "?").join(", ");

      // Remove gallery rows before their source messages, including reply media.
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM gallery WHERE channel_id = ? AND (id = ? OR id IN (SELECT id FROM messages WHERE reply_to = ? AND channel_id = ?))"
        ).bind(channel_id, message_id, message_id, channel_id),
        env.DB.prepare(
          `DELETE FROM message_actor_identities
           WHERE record_type = 'message' AND record_id IN (${mappingPlaceholders})`
        ).bind(...deletedIds),
        env.DB.prepare("DELETE FROM messages WHERE id = ? AND channel_id = ?")
          .bind(message_id, channel_id),
        env.DB.prepare("DELETE FROM messages WHERE reply_to = ? AND channel_id = ?")
          .bind(message_id, channel_id),
      ]);
      await Promise.all([
        ...deletedIds.map((id) => deleteUploadTicketByAttachment(env, "message", id)),
        ...mediaKeys.map((key) => env.MEDIA.delete(key).catch(() => {})),
      ]);

      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "message-deleted", message_id, deleted_ids: deletedIds, soft: false }),
      }));

      return Response.json({ ok: true });
    }

    case "delete-dm": {
      const { dm_id } = payload || {};
      const dm = await env.DB.prepare("SELECT image FROM dm WHERE id = ? AND channel_id = ?")
        .bind(dm_id, channel_id).first<{ image: string | null }>();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM message_actor_identities WHERE record_id = ? AND record_type = 'dm'")
          .bind(dm_id),
        env.DB.prepare("DELETE FROM dm WHERE id = ? AND channel_id = ?")
          .bind(dm_id, channel_id),
      ]);
      await deleteMediaByUrl(env, dm?.image);
      await deleteUploadTicketByAttachment(env, "dm", dm_id as string);

      const doId2 = env.CHAT_ROOM.idFromName(channel_id);
      const stub2 = env.CHAT_ROOM.get(doId2);
      await stub2.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "dm-deleted", dm_id }),
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
      let previousBackgroundImage: string | null = null;

      if (name !== undefined) { updates.push("name = ?"); values.push(name); }
      if (profile_image !== undefined) { updates.push("profile_image = ?"); values.push(profile_image); }
      if (bubble_color !== undefined) { updates.push("bubble_color = ?"); values.push(bubble_color); }
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
        const previousBackground = await env.DB.prepare(
          "SELECT background_image FROM channels WHERE id = ?"
        ).bind(channel_id).first<{ background_image: string | null }>();
        previousBackgroundImage = previousBackground?.background_image || null;
        if (background_image !== null) {
          let validBackgroundImage = false;
          if (typeof background_image === "string") {
            try {
              const imageUrl = new URL(background_image);
              validBackgroundImage = imageUrl.pathname.startsWith("/api/media/")
                && (
                  imageUrl.hostname === "letsplay-api.letmetellu.workers.dev"
                  || imageUrl.hostname === "localhost"
                  || imageUrl.hostname === "127.0.0.1"
                );
            } catch {}
          }
          if (!validBackgroundImage) {
            return Response.json({ error: "invalid background image" }, { status: 400 });
          }
        }
        updates.push("background_image = ?");
        values.push(background_image);
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
            bubble_color,
            show_on_profile,
            background_type,
            background_color,
            background_image,
            background_overlay,
            background_blur,
          }),
        }));

        if (
          background_image !== undefined
          && previousBackgroundImage
          && previousBackgroundImage !== background_image
        ) {
          try {
            const previousUrl = new URL(previousBackgroundImage);
            const key = decodeURIComponent(previousUrl.pathname.replace(/^\/api\/media\//, ""));
            if (key && previousUrl.pathname.startsWith("/api/media/")) {
              await env.MEDIA.delete(key);
            }
          } catch {}
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
      const liveState = JSON.stringify({ active: true, title: title || "라이브 채팅", sessionId });

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
        body: JSON.stringify({ type: "live-started", channel_id, title: title || "라이브 채팅", sessionId }),
      }));

      return Response.json({ ok: true, sessionId });
    }

    case "end-live": {
      const liveChannelId = `${channel_id}_live`;

      // Mark live as inactive
      await env.DB.prepare(
        "INSERT INTO config (id, text, channel_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = ?, updated_at = datetime('now')"
      ).bind(`live_${channel_id}`, "false", channel_id, "false").run();

      // Broadcast live-ended BEFORE cleanup so clients exit live mode
      const doId = env.CHAT_ROOM.idFromName(channel_id);
      const stub = env.CHAT_ROOM.get(doId);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "live-ended", channel_id }),
      }));

      // Collect R2 media keys from live messages before deleting
      const { results: liveMedia } = await env.DB.prepare(
        "SELECT image FROM messages WHERE channel_id = ? AND image IS NOT NULL"
      ).bind(liveChannelId).all();
      const { results: liveGalleryMedia } = await env.DB.prepare(
        "SELECT image FROM gallery WHERE channel_id = ? AND image IS NOT NULL"
      ).bind(liveChannelId).all();
      const { results: liveDmMedia } = await env.DB.prepare(
        "SELECT image FROM dm WHERE channel_id = ? AND image IS NOT NULL"
      ).bind(liveChannelId).all();
      const { results: liveUploadTickets } = await env.DB.prepare(
        "SELECT key FROM upload_tickets WHERE channel_id = ?"
      ).bind(liveChannelId).all<{ key: string }>();

      // Delete R2 objects for live media
      const allMedia = [...(liveMedia || []), ...(liveGalleryMedia || []), ...(liveDmMedia || [])];
      for (const row of allMedia) {
        if (row.image) {
          // Extract key from URL (format: .../api/media/KEY)
          const key = (row.image as string).split("/api/media/").pop();
          if (key) {
            try { await env.MEDIA.delete(key); } catch {}
          }
        }
      }
      for (const row of liveUploadTickets || []) {
        if (row.key) {
          try { await env.MEDIA.delete(row.key); } catch {}
        }
      }

      // Delete all live channel data
      await env.DB.prepare("DELETE FROM messages WHERE channel_id = ?").bind(liveChannelId).run();
      await env.DB.prepare("DELETE FROM gallery WHERE channel_id = ?").bind(liveChannelId).run();
      await env.DB.prepare("DELETE FROM dm WHERE channel_id = ?").bind(liveChannelId).run();
      await env.DB.prepare("DELETE FROM blocked WHERE channel_id = ?").bind(liveChannelId).run();
      await env.DB.prepare("DELETE FROM config WHERE channel_id = ?").bind(liveChannelId).run();
      await env.DB.prepare("DELETE FROM upload_tickets WHERE channel_id = ?").bind(liveChannelId).run();
      // Remove the temporary live channel entry
      await env.DB.prepare("DELETE FROM channels WHERE id = ?").bind(liveChannelId).run();

      return Response.json({ ok: true });
    }

    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
}
