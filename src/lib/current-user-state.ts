import type { OwnerPlanState } from "./owner-plan";

export interface CurrentUserState<TChannel = unknown> {
  user_id?: string;
  channels?: TChannel[];
  font_size?: number | null;
  locale?: string | null;
  is_platform_admin?: boolean;
  owner_plan?: OwnerPlanState;
}

export interface CurrentUserStateResult<TChannel = unknown> {
  ok: boolean;
  status: number;
  data: CurrentUserState<TChannel>;
}

const FAILED_USER_STATE_TTL_MS = 5_000;

interface CachedCurrentUserStateResult {
  result: CurrentUserStateResult;
  expiresAt: number;
}

const inFlightRequests = new Map<string, Promise<CurrentUserStateResult>>();
const cachedFailedResults = new Map<string, CachedCurrentUserStateResult>();

export function fetchCurrentUserState<TChannel = unknown>(
  userId: string,
): Promise<CurrentUserStateResult<TChannel>> {
  const cachedFailure = cachedFailedResults.get(userId);
  if (cachedFailure && cachedFailure.expiresAt > Date.now()) {
    return Promise.resolve(cachedFailure.result as CurrentUserStateResult<TChannel>);
  }
  if (cachedFailure) {
    cachedFailedResults.delete(userId);
  }

  const existingRequest = inFlightRequests.get(userId);
  if (existingRequest) {
    return existingRequest as Promise<CurrentUserStateResult<TChannel>>;
  }

  const request = (async () => {
    const response = await fetch("/api/user", { cache: "no-store" });
    const data = await response.json() as CurrentUserState<TChannel>;
    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  })();
  inFlightRequests.set(userId, request as Promise<CurrentUserStateResult>);
  const clearRequest = (result?: CurrentUserStateResult) => {
    if (inFlightRequests.get(userId) === request) {
      inFlightRequests.delete(userId);
    }
    if (result && !result.ok && (result.status === 401 || result.status === 404)) {
      cachedFailedResults.set(userId, {
        result,
        expiresAt: Date.now() + FAILED_USER_STATE_TTL_MS,
      });
      return;
    }
    cachedFailedResults.delete(userId);
  };
  void request.then(
    (result) => clearRequest(result),
    () => clearRequest(),
  );
  return request;
}
