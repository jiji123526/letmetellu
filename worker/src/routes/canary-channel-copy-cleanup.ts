import type { Env } from "../types.ts";
import {
  canaryCleanupAuthorized,
  unavailableCanaryOperatorResponse,
} from "../lib/canary-operator-auth.ts";
import {
  abandonCanaryChannelCopy,
  cleanupCanaryChannelCopy,
} from "../lib/canary-channel-copy-cleanup.ts";
import {
  type CanaryShardId,
  isCanaryProjectionDispatchEnabled,
} from "../lib/channel-projection-dispatcher.ts";
import { isReportsChannel } from "../lib/special-channels.ts";

const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;
const MAX_COMMAND_BYTES = 1024;

interface CleanupCommand {
  action: "abandon" | "cleanup";
  shard: CanaryShardId;
  channel: string;
  sourceProjectionVersion: number;
}

function parseCommand(text: string): CleanupCommand | null {
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
    Object.keys(input).sort().join(",")
      !== "action,channel,shard,sourceProjectionVersion"
    || (input.action !== "abandon" && input.action !== "cleanup")
    || (input.shard !== "canary-a" && input.shard !== "canary-b")
    || typeof input.channel !== "string"
    || !CHANNEL_ID_PATTERN.test(input.channel)
    || typeof input.sourceProjectionVersion !== "number"
    || !Number.isSafeInteger(input.sourceProjectionVersion)
    || input.sourceProjectionVersion <= 0
  ) {
    return null;
  }
  return input as unknown as CleanupCommand;
}

export async function handleCanaryChannelCopyCleanup(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!canaryCleanupAuthorized(request, env)) {
    return unavailableCanaryOperatorResponse();
  }
  if (request.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed" },
      {
        status: 405,
        headers: { "Allow": "POST", "Cache-Control": "no-store" },
      },
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
  if (isCanaryProjectionDispatchEnabled(env)) {
    return Response.json(
      { error: "cleanup_requires_dispatch_disabled" },
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
    const input = {
      env,
      shardId: command.shard,
      channelId: command.channel,
      sourceProjectionVersion: command.sourceProjectionVersion,
    };
    const result = command.action === "abandon"
      ? await abandonCanaryChannelCopy(input)
      : await cleanupCanaryChannelCopy(input);
    return Response.json(result, {
      status: result.blockers.length === 0 ? 200 : 409,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "canary_cleanup_failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
