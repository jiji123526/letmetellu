import type { Env } from "../types.ts";
import {
  canaryCopyAuthorized,
  unavailableCanaryOperatorResponse,
} from "../lib/canary-operator-auth.ts";
import type { CanaryShardId } from "../lib/channel-projection-dispatcher.ts";
import { isCanaryProjectionDispatchEnabled } from "../lib/channel-projection-dispatcher.ts";
import { isReportsChannel } from "../lib/special-channels.ts";
import {
  copyCanaryCanonicalChannels,
  copyCanaryPolicyConfigBatch,
  startCanaryChannelCopy,
} from "../lib/canary-channel-copy.ts";

const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;
const MAX_COMMAND_BYTES = 1024;

interface CopyCommand {
  action: "start" | "copy-channels" | "copy-policy-config";
  shard: CanaryShardId;
  channel: string;
}

function parseCommand(text: string): CopyCommand | null {
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
    || (
      input.action !== "start"
      && input.action !== "copy-channels"
      && input.action !== "copy-policy-config"
    )
    || (input.shard !== "canary-a" && input.shard !== "canary-b")
    || typeof input.channel !== "string"
    || !CHANNEL_ID_PATTERN.test(input.channel)
  ) {
    return null;
  }
  return input as unknown as CopyCommand;
}

export async function handleCanaryChannelCopyMutation(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!canaryCopyAuthorized(request, env)) {
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
      { error: "copy_requires_dispatch_disabled" },
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
    const operationInput = {
      env,
      shardId: command.shard,
      channelId: command.channel,
    };
    const result = command.action === "start"
      ? await startCanaryChannelCopy(operationInput)
      : command.action === "copy-channels"
        ? await copyCanaryCanonicalChannels(operationInput)
        : await copyCanaryPolicyConfigBatch(operationInput);
    return Response.json(result, {
      status: result.blockers.length === 0 ? 200 : 409,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "canary_copy_failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
