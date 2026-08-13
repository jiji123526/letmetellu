import type { Env } from "../types.ts";
import { recordOperationalEvent } from "./operational-events.ts";

export async function readInitPresenceCount(env: Env, channelId: string): Promise<number> {
  try {
    const doId = env.CHAT_ROOM.idFromName(channelId);
    const response = await env.CHAT_ROOM.get(doId).fetch(new Request("http://internal/presence"));
    if (!response.ok) {
      throw new Error(`presence request failed with ${response.status}`);
    }
    const payload = await response.json() as { count?: unknown };
    if (typeof payload.count !== "number" || !Number.isFinite(payload.count) || payload.count < 0) {
      throw new Error("presence response was invalid");
    }
    return payload.count;
  } catch (error) {
    await recordOperationalEvent({
      env,
      severity: "warn",
      route: "GET /api/init",
      eventType: "realtime_unavailable",
      targetId: channelId,
      detail: {
        route_stage: "load_presence",
        request_channel_id: channelId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return 0;
  }
}
