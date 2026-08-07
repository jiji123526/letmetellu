export interface CurrentUserState<TChannel = unknown> {
  user_id?: string;
  channels?: TChannel[];
  font_size?: number | null;
  locale?: string | null;
  is_platform_admin?: boolean;
}

export interface CurrentUserStateResult<TChannel = unknown> {
  ok: boolean;
  status: number;
  data: CurrentUserState<TChannel>;
}

const inFlightRequests = new Map<string, Promise<CurrentUserStateResult>>();

export function fetchCurrentUserState<TChannel = unknown>(
  userId: string,
): Promise<CurrentUserStateResult<TChannel>> {
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
  const clearRequest = () => {
    if (inFlightRequests.get(userId) === request) {
      inFlightRequests.delete(userId);
    }
  };
  void request.then(clearRequest, clearRequest);
  return request;
}
