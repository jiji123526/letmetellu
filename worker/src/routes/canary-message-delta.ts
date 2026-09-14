import type { Env } from "../types.ts";
import {
  canaryFinalizeAuthorized,
  unavailableCanaryOperatorResponse,
} from "../lib/canary-operator-auth.ts";
import {
  reconcileCanaryMessageDeltaBatch,
  startCanaryMessageDelta,
  completeCanaryMessageDelta,
} from "../lib/canary-message-delta.ts";
import { copyCanaryMessageDependentsBatch } from "../lib/canary-message-dependents.ts";
import {
  completeCanaryDmDelta,
  reconcileCanaryDmDeltaBatch,
} from "../lib/canary-dm-delta.ts";
import type { CanaryShardId } from "../lib/channel-projection-dispatcher.ts";
import { isCanaryProjectionDispatchEnabled } from "../lib/channel-projection-dispatcher.ts";
import { isReportsChannel } from "../lib/special-channels.ts";

const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;
const MAX_COMMAND_BYTES = 1024;

interface DeltaCommand {
  action:
    | "start"
    | "reconcile"
    | "rebuild-dependents"
    | "complete"
    | "reconcile-dm"
    | "complete-dm";
  shard: CanaryShardId;
  channel: string;
}

function parseCommand(text: string): DeltaCommand | null {
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
      && input.action !== "reconcile"
      && input.action !== "rebuild-dependents"
      && input.action !== "complete"
      && input.action !== "reconcile-dm"
      && input.action !== "complete-dm"
    )
    || (input.shard !== "canary-a" && input.shard !== "canary-b")
    || typeof input.channel !== "string"
    || !CHANNEL_ID_PATTERN.test(input.channel)
  ) return null;
  return input as unknown as DeltaCommand;
}

export async function handleCanaryMessageDelta(request: Request, env: Env) {
  if (!canaryFinalizeAuthorized(request, env)) {
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
      { error: "delta_requires_write_maintenance" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (isCanaryProjectionDispatchEnabled(env)) {
    return Response.json(
      { error: "delta_requires_dispatch_disabled" },
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
    const input = { env, shardId: command.shard, channelId: command.channel };
    const result = command.action === "start"
      ? await startCanaryMessageDelta(input)
      : command.action === "reconcile"
        ? await reconcileCanaryMessageDeltaBatch(input)
        : command.action === "rebuild-dependents"
          ? await copyCanaryMessageDependentsBatch(input)
          : command.action === "complete"
            ? await completeCanaryMessageDelta(input)
            : command.action === "reconcile-dm"
              ? await reconcileCanaryDmDeltaBatch(input)
              : await completeCanaryDmDelta(input);
    return Response.json(result, {
      status: result.blockers.length === 0 ? 200 : 409,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "canary_delta_failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
