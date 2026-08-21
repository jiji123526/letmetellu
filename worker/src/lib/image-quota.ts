import type { Env } from "../types.ts";
import {
  buildImageQuotaActorIdentity,
  hasActivePlusEntitlement,
} from "./plan-entitlements.ts";

export const FREE_DAILY_IMAGE_MESSAGE_LIMIT = 5;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type ImageQuotaRecordType = "message" | "dm" | "dm_reply";

export interface PreparedImageQuotaConsumption {
  ok: true;
  bypassed: boolean;
  statement: D1PreparedStatement | null;
  quotaDate: string;
}

export interface RejectedImageQuotaConsumption {
  ok: false;
  error: "image_quota_exceeded" | "image_quota_identity_missing";
  quotaDate: string;
}

function asCount(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10) || 0;
  return 0;
}

export function getImageQuotaDateBucket(now = new Date().toISOString()): string {
  // Product decision: the free daily image allowance resets at midnight KST
  // regardless of the sender's local browser timezone.
  return new Date(new Date(now).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export async function prepareAcceptedImageQuotaConsumption(
  env: Env,
  input: {
    authenticatedUserId?: string | null;
    anonymousUid?: string | null;
    deviceId?: string | null;
    channelId: string;
    recordType: ImageQuotaRecordType;
    recordId: string;
    now?: string;
  },
): Promise<PreparedImageQuotaConsumption | RejectedImageQuotaConsumption> {
  const now = input.now || new Date().toISOString();
  const quotaDate = getImageQuotaDateBucket(now);
  const authenticatedUserId = input.authenticatedUserId?.trim() || "";

  if (authenticatedUserId && await hasActivePlusEntitlement(env, authenticatedUserId, now)) {
    return {
      ok: true,
      bypassed: true,
      statement: null,
      quotaDate,
    };
  }

  const actor = buildImageQuotaActorIdentity({
    authenticatedUserId,
    anonymousUid: input.anonymousUid,
    deviceId: input.deviceId,
  });
  if (!actor) {
    return {
      ok: false,
      error: "image_quota_identity_missing",
      quotaDate,
    };
  }

  const [primaryRow, secondaryRow] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM image_quota_events
      WHERE actor_key = ? AND quota_date = ?
    `).bind(actor.primaryKey, quotaDate).first<{ count: number | string }>(),
    actor.secondaryKey
      ? env.DB.prepare(`
          SELECT COUNT(*) AS count
          FROM image_quota_events
          WHERE secondary_actor_key = ? AND quota_date = ?
        `).bind(actor.secondaryKey, quotaDate).first<{ count: number | string }>()
      : Promise.resolve<{ count: number | string } | null>(null),
  ]);

  const effectiveCount = Math.max(
    asCount(primaryRow?.count),
    asCount(secondaryRow?.count),
  );
  if (effectiveCount >= FREE_DAILY_IMAGE_MESSAGE_LIMIT) {
    return {
      ok: false,
      error: "image_quota_exceeded",
      quotaDate,
    };
  }

  return {
    ok: true,
    bypassed: false,
    quotaDate,
    statement: env.DB.prepare(`
      INSERT INTO image_quota_events (
        consumption_key, actor_key, actor_type, secondary_actor_key,
        secondary_actor_type, quota_date, channel_id, record_type, record_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `image:${input.recordType}:${input.recordId}`,
      actor.primaryKey,
      actor.primaryType,
      actor.secondaryKey,
      actor.secondaryType,
      quotaDate,
      input.channelId,
      input.recordType,
      input.recordId,
      now,
    ),
  };
}
