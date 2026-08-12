import type { Env } from "../types.ts";

export function getParentChannelId(channelId: string): string {
  return channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
}

export function getReportsChannelId(env: Env): string | null {
  const configured = env.REPORTS_CHANNEL_ID?.trim();
  return configured ? configured : null;
}

export function isReportsChannel(channelId: string, env: Env): boolean {
  const reportsChannelId = getReportsChannelId(env);
  return Boolean(reportsChannelId && getParentChannelId(channelId) === reportsChannelId);
}

export async function getReportsChannelOwnerId(env: Env): Promise<string | null> {
  const reportsChannelId = getReportsChannelId(env);
  if (!reportsChannelId) return null;
  const channel = await env.DB.prepare("SELECT owner_uid FROM channels WHERE id = ?")
    .bind(reportsChannelId)
    .first<{ owner_uid: string }>();
  return channel?.owner_uid || null;
}

export async function isReportsChannelOwner(userId: string | null | undefined, env: Env): Promise<boolean> {
  if (!userId) return false;
  const ownerId = await getReportsChannelOwnerId(env);
  return Boolean(ownerId && ownerId === userId);
}
