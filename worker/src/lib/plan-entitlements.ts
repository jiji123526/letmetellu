import type { Env } from "../types.ts";

export interface ActiveUserEntitlement {
  id: string;
  user_id: string;
  provider: string | null;
  plan: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  source_order_id: string | null;
  source_type: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  auto_renews: number;
  grandfathered_channel_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImageQuotaActorIdentity {
  primaryKey: string;
  primaryType: "authenticated" | "anonymous";
  secondaryKey: string | null;
  secondaryType: "device" | null;
}

export async function readActivePlusEntitlement(
  env: Env,
  userId: string | null | undefined,
  now = new Date().toISOString(),
): Promise<ActiveUserEntitlement | null> {
  if (!userId) return null;
  return env.DB.prepare(`
    SELECT id, user_id, provider, plan, status, starts_at, ends_at,
           source_order_id, source_type, provider_customer_id,
           provider_subscription_id, auto_renews, grandfathered_channel_id,
           created_at, updated_at
    FROM user_entitlements
    WHERE user_id = ?
      AND plan = 'plus'
      AND status = 'active'
      AND starts_at <= ?
      AND (ends_at IS NULL OR ends_at > ?)
    ORDER BY starts_at DESC, updated_at DESC
    LIMIT 1
  `).bind(userId, now, now).first<ActiveUserEntitlement>();
}

export async function hasActivePlusEntitlement(
  env: Env,
  userId: string | null | undefined,
  now = new Date().toISOString(),
): Promise<boolean> {
  return Boolean(await readActivePlusEntitlement(env, userId, now));
}

export function buildImageQuotaActorIdentity(input: {
  authenticatedUserId?: string | null;
  anonymousUid?: string | null;
  deviceId?: string | null;
}): ImageQuotaActorIdentity | null {
  const authenticatedUserId = input.authenticatedUserId?.trim() || "";
  if (authenticatedUserId) {
    return {
      primaryKey: `user:${authenticatedUserId}`,
      primaryType: "authenticated",
      secondaryKey: null,
      secondaryType: null,
    };
  }

  const anonymousUid = input.anonymousUid?.trim() || "";
  if (!anonymousUid) return null;

  const deviceId = input.deviceId?.trim() || "";
  return {
    primaryKey: `anonymous:${anonymousUid}`,
    primaryType: "anonymous",
    secondaryKey: deviceId ? `device:${deviceId}` : null,
    secondaryType: deviceId ? "device" : null,
  };
}
