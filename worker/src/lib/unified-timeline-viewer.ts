import type { Env } from "../types.ts";
import { verifyAnonymousIdentityToken } from "./anonymous-identity.ts";

export type UnifiedTimelineViewer =
  | { owner: true }
  | { owner: false; anonymousUid: string };

export async function resolveUnifiedTimelineViewer(
  request: Request,
  env: Env,
  isOwner: boolean,
): Promise<UnifiedTimelineViewer | null> {
  if (isOwner) return { owner: true };

  const token = request.headers.get("X-Anonymous-Token") || "";
  if (!token) return null;
  const identity = await verifyAnonymousIdentityToken(token, env);
  if (!identity) return null;
  return { owner: false, anonymousUid: identity.uid };
}
