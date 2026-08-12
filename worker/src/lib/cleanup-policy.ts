const CLEANUP_RETRY_BASE_MS = 60_000;
const CLEANUP_RETRY_MAX_MS = 24 * 60 * 60 * 1000;

export function getCleanupRetryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(20, Math.floor(attemptCount) - 1));
  return Math.min(CLEANUP_RETRY_MAX_MS, CLEANUP_RETRY_BASE_MS * (2 ** exponent));
}

export function parseCleanupMediaKeys(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("invalid cleanup media snapshot");
  }
  if (
    !Array.isArray(parsed)
    || parsed.some((key) => typeof key !== "string" || key.length === 0 || key.length > 1024)
  ) {
    throw new Error("invalid cleanup media snapshot");
  }
  return [...new Set(parsed)];
}
