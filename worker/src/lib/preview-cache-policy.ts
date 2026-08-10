export const PREVIEW_SUCCESS_CACHE_TTL_SECONDS = 60 * 60;
export const PREVIEW_EMPTY_CACHE_TTL_SECONDS = 5 * 60;

const PREVIEW_PERMANENT_FAILURE_CACHE_TTL_SECONDS = 15 * 60;
const PREVIEW_TRANSIENT_FAILURE_CACHE_TTL_SECONDS = 60;

export function getPreviewFailureCacheTtl(status: number): number | null {
  if (status === 400 || status === 404 || status === 415) {
    return PREVIEW_PERMANENT_FAILURE_CACHE_TTL_SECONDS;
  }
  if (status === 502 || status === 503 || status === 504) {
    return PREVIEW_TRANSIENT_FAILURE_CACHE_TTL_SECONDS;
  }
  return null;
}
