import type { Env } from "../types.ts";

export function isTrustedInternalRequest(request: Request, env: Env): boolean {
  return request.headers.get("X-Internal-Token") === env.INTERNAL_SECRET;
}

export function getTrustedUserId(request: Request, env: Env): string | null {
  if (!isTrustedInternalRequest(request, env)) return null;
  return request.headers.get("X-User-Id") || null;
}
