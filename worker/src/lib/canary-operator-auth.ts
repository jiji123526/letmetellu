import type { Env } from "../types.ts";

const MIN_OPERATOR_TOKEN_LENGTH = 32;
const MAX_OPERATOR_TOKEN_LENGTH = 256;

function dedicatedCanarySecretAuthorized(
  request: Request,
  configuredValue: string | undefined,
  headerName: string,
): boolean {
  const configured = configuredValue || "";
  if (
    configured.length < MIN_OPERATOR_TOKEN_LENGTH
    || configured.length > MAX_OPERATOR_TOKEN_LENGTH
  ) {
    return false;
  }
  const presented = request.headers.get(headerName) || "";
  if (presented.length !== configured.length) return false;
  let mismatch = 0;
  for (let index = 0; index < configured.length; index += 1) {
    mismatch |= presented.charCodeAt(index) ^ configured.charCodeAt(index);
  }
  return mismatch === 0;
}

export function canaryOperatorAuthorized(request: Request, env: Env): boolean {
  return dedicatedCanarySecretAuthorized(
    request,
    env.D1_CANARY_OPERATOR_TOKEN,
    "X-Canary-Operator-Token",
  );
}

export function canaryCopyAuthorized(request: Request, env: Env): boolean {
  return dedicatedCanarySecretAuthorized(
    request,
    env.D1_CANARY_COPY_TOKEN,
    "X-Canary-Copy-Token",
  );
}

export function unavailableCanaryOperatorResponse(): Response {
  return Response.json(
    { error: "not_found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}
