import type { Env } from "../types.ts";
import {
  canaryDispatchAuthorized,
  unavailableCanaryOperatorResponse,
} from "../lib/canary-operator-auth.ts";
import { drainChannelProjectionEvents } from "../lib/channel-projection-consumer.ts";
import {
  isCanaryProjectionDispatchEnabled,
  resolveCanaryProjectionSource,
  type CanaryShardId,
} from "../lib/channel-projection-dispatcher.ts";
import { isReportsChannel } from "../lib/special-channels.ts";

const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;
const MAX_COMMAND_BYTES = 512;

interface DispatchCommand {
  action: "dispatch-channel-reports";
  shard: CanaryShardId;
  channel: string;
}

function parseCommand(text: string): DispatchCommand | null {
  if (new TextEncoder().encode(text).byteLength > MAX_COMMAND_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(",") !== "action,channel,shard"
    || input.action !== "dispatch-channel-reports"
    || (input.shard !== "canary-a" && input.shard !== "canary-b")
    || typeof input.channel !== "string"
    || !CHANNEL_ID_PATTERN.test(input.channel)
  ) return null;
  return input as unknown as DispatchCommand;
}

export async function handleCanaryProjectionDispatchOnce(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!canaryDispatchAuthorized(request, env)) {
    return unavailableCanaryOperatorResponse();
  }
  if (request.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { "Allow": "POST", "Cache-Control": "no-store" } },
    );
  }
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase()
    !== "application/json"
  ) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (env.WRITE_MAINTENANCE_MODE !== "true") {
    return Response.json(
      { error: "dispatch_exercise_requires_write_maintenance" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (isCanaryProjectionDispatchEnabled(env)) {
    return Response.json(
      { error: "scheduled_dispatch_must_be_disabled" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  const command = parseCommand(await request.text());
  if (!command || isReportsChannel(command.channel, env)) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const source = resolveCanaryProjectionSource(env, command.shard);
    const result = await drainChannelProjectionEvents({
      sourceDatabase: source.database,
      controlDatabase: env.DB,
      channelId: command.channel,
      aggregateType: "channel_report",
      limit: 10,
    });
    return Response.json({
      shardId: command.shard,
      channelId: command.channel,
      aggregateType: "channel_report",
      result,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "canary_projection_dispatch_failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
