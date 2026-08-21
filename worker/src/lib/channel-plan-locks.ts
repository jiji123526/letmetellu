import type { Env } from "../types.ts";
import {
  readActivePlusEntitlement,
  type ActiveUserEntitlement,
} from "./plan-entitlements.ts";
import { getReportsChannelId, isReportsChannel } from "./special-channels.ts";

interface OwnedChannelActivity {
  id: string;
  last_activity_at: string;
}

interface RetentionChoiceRow {
  retained_channel_id: string;
  effective_at: string;
}

export interface OwnerChannelRetentionState {
  ownedChannelCount: number;
  retainedChannelId: string | null;
  effectiveAt: string | null;
  selectionRequired: boolean;
  locksActive: boolean;
}

export interface ChannelPlanLockState {
  exists: boolean;
  ownerUserId: string | null;
  retainedChannelId: string | null;
  locked: boolean;
}

async function readOwnedChannelActivity(
  env: Env,
  userId: string,
): Promise<OwnedChannelActivity[]> {
  const reportsChannelId = getReportsChannelId(env) || "";
  const { results } = await env.DB.prepare(`
    SELECT channels.id,
           COALESCE((
             SELECT messages.created_at
             FROM messages
             WHERE messages.channel_id = channels.id
               AND messages.deleted = 0
             ORDER BY messages.created_at DESC, messages.id DESC
             LIMIT 1
           ), channels.created_at) AS last_activity_at
    FROM channels
    WHERE channels.owner_uid = ?
      AND channels.id NOT LIKE '%_live'
      AND channels.id != ?
    ORDER BY last_activity_at DESC, channels.created_at DESC, channels.id DESC
  `).bind(userId, reportsChannelId).all<OwnedChannelActivity>();
  return results || [];
}

async function readRetentionChoice(
  env: Env,
  userId: string,
): Promise<RetentionChoiceRow | null> {
  return env.DB.prepare(`
    SELECT choices.retained_channel_id, choices.effective_at
    FROM user_channel_retention_choices AS choices
    INNER JOIN channels
      ON channels.id = choices.retained_channel_id
     AND channels.owner_uid = choices.user_id
     AND channels.id NOT LIKE '%_live'
    WHERE choices.user_id = ?
    LIMIT 1
  `).bind(userId).first<RetentionChoiceRow>();
}

function isExpiringEntitlement(
  entitlement: ActiveUserEntitlement | null,
): entitlement is ActiveUserEntitlement {
  return Boolean(
    entitlement?.ends_at
    && Number(entitlement.auto_renews) === 0,
  );
}

function hasFiniteEntitlement(
  entitlement: ActiveUserEntitlement | null,
): entitlement is ActiveUserEntitlement {
  return Boolean(entitlement?.ends_at);
}

export async function readOwnerChannelRetentionState(
  env: Env,
  userId: string,
  now = new Date().toISOString(),
): Promise<OwnerChannelRetentionState> {
  const [activeEntitlement, channels, choice] = await Promise.all([
    readActivePlusEntitlement(env, userId, now),
    readOwnedChannelActivity(env, userId),
    readRetentionChoice(env, userId),
  ]);
  const ownedIds = new Set(channels.map((channel) => channel.id));
  const retainedChannelId = choice && ownedIds.has(choice.retained_channel_id)
    ? choice.retained_channel_id
    : channels[0]?.id || null;
  const hasExcessChannels = channels.length > 1;

  return {
    ownedChannelCount: channels.length,
    retainedChannelId,
    effectiveAt: choice?.effective_at || (isExpiringEntitlement(activeEntitlement) ? activeEntitlement.ends_at : null),
    selectionRequired: hasExcessChannels && isExpiringEntitlement(activeEntitlement),
    locksActive: hasExcessChannels && !activeEntitlement,
  };
}

export async function ensureDefaultChannelRetentionChoice(
  env: Env,
  userId: string,
  effectiveAt: string,
): Promise<OwnerChannelRetentionState> {
  const channels = await readOwnedChannelActivity(env, userId);
  if (channels.length > 1) {
    await env.DB.prepare(`
      INSERT INTO user_channel_retention_choices (
        user_id, retained_channel_id, effective_at
      ) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO NOTHING
    `).bind(userId, channels[0].id, effectiveAt).run();
  }
  return readOwnerChannelRetentionState(env, userId);
}

export async function selectChannelRetentionChoice(
  env: Env,
  userId: string,
  channelId: string,
  now = new Date().toISOString(),
): Promise<
  | { ok: true; state: OwnerChannelRetentionState }
  | { ok: false; error: string; status: number }
> {
  const [activeEntitlement, channels] = await Promise.all([
    readActivePlusEntitlement(env, userId, now),
    readOwnedChannelActivity(env, userId),
  ]);
  if (!hasFiniteEntitlement(activeEntitlement)) {
    return { ok: false, error: "retention_selection_unavailable", status: 409 };
  }
  if (channels.length <= 1) {
    return { ok: false, error: "retention_selection_not_required", status: 409 };
  }
  if (!channels.some((channel) => channel.id === channelId)) {
    return { ok: false, error: "channel_not_owned", status: 403 };
  }

  await env.DB.prepare(`
    INSERT INTO user_channel_retention_choices (
      user_id, retained_channel_id, effective_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      retained_channel_id = excluded.retained_channel_id,
      effective_at = excluded.effective_at,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(userId, channelId, activeEntitlement.ends_at).run();

  return {
    ok: true,
    state: await readOwnerChannelRetentionState(env, userId, now),
  };
}

export async function readChannelPlanLockState(
  env: Env,
  channelId: string,
  now = new Date().toISOString(),
): Promise<ChannelPlanLockState> {
  if (isReportsChannel(channelId, env)) {
    return {
      exists: true,
      ownerUserId: null,
      retainedChannelId: channelId,
      locked: false,
    };
  }
  const reportsChannelId = getReportsChannelId(env) || "";
  const row = await env.DB.prepare(`
    WITH target AS (
      SELECT id, owner_uid
      FROM channels
      WHERE id = ?
        AND id NOT LIKE '%_live'
      LIMIT 1
    )
    SELECT
      target.owner_uid,
      EXISTS (
        SELECT 1
        FROM user_entitlements
        WHERE user_id = target.owner_uid
          AND plan = 'plus'
          AND status = 'active'
          AND starts_at <= ?
          AND (ends_at IS NULL OR ends_at > ?)
      ) AS has_plus,
      (
        SELECT COUNT(*)
        FROM channels AS owned
        WHERE owned.owner_uid = target.owner_uid
          AND owned.id NOT LIKE '%_live'
          AND owned.id != ?
      ) AS owned_channel_count,
      COALESCE(
        (
          SELECT choices.retained_channel_id
          FROM user_channel_retention_choices AS choices
          INNER JOIN channels AS selected
            ON selected.id = choices.retained_channel_id
           AND selected.owner_uid = choices.user_id
           AND selected.id NOT LIKE '%_live'
          WHERE choices.user_id = target.owner_uid
          LIMIT 1
        ),
        (
          SELECT fallback.id
          FROM channels AS fallback
          WHERE fallback.owner_uid = target.owner_uid
            AND fallback.id NOT LIKE '%_live'
            AND fallback.id != ?
          ORDER BY COALESCE((
            SELECT messages.created_at
            FROM messages
            WHERE messages.channel_id = fallback.id
              AND messages.deleted = 0
            ORDER BY messages.created_at DESC, messages.id DESC
            LIMIT 1
          ), fallback.created_at) DESC,
          fallback.created_at DESC,
          fallback.id DESC
          LIMIT 1
        )
      ) AS retained_channel_id
    FROM target
  `).bind(channelId, now, now, reportsChannelId, reportsChannelId).first<{
    owner_uid: string;
    has_plus: number;
    owned_channel_count: number;
    retained_channel_id: string | null;
  }>();
  if (!row) {
    return {
      exists: false,
      ownerUserId: null,
      retainedChannelId: null,
      locked: false,
    };
  }
  return {
    exists: true,
    ownerUserId: row.owner_uid,
    retainedChannelId: row.retained_channel_id,
    locked: Number(row.has_plus) !== 1
      && Number(row.owned_channel_count) > 1
      && row.retained_channel_id !== channelId,
  };
}
