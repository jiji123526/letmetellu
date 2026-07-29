import { Env } from "../types";

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
