import type { Env } from "../types.ts";
import {
  canaryOperatorAuthorized,
  unavailableCanaryOperatorResponse,
} from "../lib/canary-operator-auth.ts";
import type { CanaryShardId } from "../lib/channel-projection-dispatcher.ts";
import { verifyCanaryMessageDerivedState } from "../lib/canary-message-derived-verification.ts";
import { isReportsChannel } from "../lib/special-channels.ts";

const CHANNEL_ID_PATTERN = /^[a-z0-9-]{3,30}$/;

export async function handleCanaryChannelCopyVerification(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!canaryOperatorAuthorized(request, env)) {
    return unavailableCanaryOperatorResponse();
  }
  if (request.method !== "GET") {
    return Response.json(
      { error: "method_not_allowed" },
      {
        status: 405,
        headers: { "Allow": "GET", "Cache-Control": "no-store" },
      },
    );
  }

  const url = new URL(request.url);
  const shard = url.searchParams.get("shard");
  const channelId = url.searchParams.get("channel") || "";
  if (
    (shard !== "canary-a" && shard !== "canary-b")
    || !CHANNEL_ID_PATTERN.test(channelId)
    || isReportsChannel(channelId, env)
  ) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await verifyCanaryMessageDerivedState({
      env,
      shardId: shard as CanaryShardId,
      channelId,
    });
    return Response.json(result, {
      status: result.ready ? 200 : 409,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "canary_copy_verification_failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
