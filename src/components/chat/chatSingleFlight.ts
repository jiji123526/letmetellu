export interface InFlightRequest<T> {
  current: Promise<T> | null;
}

export function shareInFlightRequest<T>(
  holder: InFlightRequest<T>,
  start: () => Promise<T>,
): Promise<T> {
  if (holder.current) return holder.current;
  const request = start();
  holder.current = request;
  void request.finally(() => {
    if (holder.current === request) holder.current = null;
  }).catch(() => {});
  return request;
}
