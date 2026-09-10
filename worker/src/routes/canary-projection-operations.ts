import type { Env } from "../types.ts";
import {
  type CanaryShardId,
  resolveCanaryProjectionSource,
} from "../lib/channel-projection-dispatcher.ts";
import { reconcileChannelProjections } from "../lib/channel-projection-reconciliation.ts";

const MIN_OPERATOR_TOKEN_LENGTH = 32;
const MAX_OPERATOR_TOKEN_LENGTH = 256;
const MAX_RECONCILIATION_LIMIT = 100;
const CHANNEL_CURSOR_PATTERN = /^[a-z0-9-]{3,30}$/;

function unavailable(): Response {
  return Response.json(
    { error: "not_found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

function operatorTokenAuthorized(request: Request, env: Env): boolean {
  const configured = env.D1_CANARY_OPERATOR_TOKEN || "";
  if (
    configured.length < MIN_OPERATOR_TOKEN_LENGTH
    || configured.length > MAX_OPERATOR_TOKEN_LENGTH
  ) {
    return false;
  }
  const presented = request.headers.get("X-Canary-Operator-Token") || "";
  if (presented.length !== configured.length) return false;
  let mismatch = 0;
  for (let index = 0; index < configured.length; index += 1) {
    mismatch |= presented.charCodeAt(index) ^ configured.charCodeAt(index);
  }
  return mismatch === 0;
}

function parseShardId(value: string | null): CanaryShardId | null {
  return value === "canary-a" || value === "canary-b" ? value : null;
}

function parseLimit(value: string | null): number | null {
  if (value === null || value === "") return MAX_RECONCILIATION_LIMIT;
  if (!/^[1-9]\d{0,2}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed <= MAX_RECONCILIATION_LIMIT ? parsed : null;
}

export async function handleCanaryProjectionReconciliation(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!operatorTokenAuthorized(request, env)) return unavailable();
  if (request.method !== "GET") {
    return Response.json(
      { error: "method_not_allowed" },
      {
        status: 405,
        headers: {
          "Allow": "GET",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const url = new URL(request.url);
  const shardId = parseShardId(url.searchParams.get("shard"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = url.searchParams.get("cursor") || "";
  if (
    !shardId
    || limit === null
    || (cursor !== "" && !CHANNEL_CURSOR_PATTERN.test(cursor))
  ) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  let sourceDatabase: D1Database;
  try {
    sourceDatabase = resolveCanaryProjectionSource(env, shardId).database;
  } catch {
    return Response.json(
      { error: "canary_shard_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await reconcileChannelProjections({
    sourceDatabase,
    controlDatabase: env.DB,
    cursor,
    limit,
  });
  return Response.json(
    { shardId, ...result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
