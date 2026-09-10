import type { Env } from "../types.ts";

const MIN_OPERATOR_TOKEN_LENGTH = 32;
const MAX_OPERATOR_TOKEN_LENGTH = 256;

export function canaryOperatorAuthorized(request: Request, env: Env): boolean {
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

export function unavailableCanaryOperatorResponse(): Response {
  return Response.json(
    { error: "not_found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}
