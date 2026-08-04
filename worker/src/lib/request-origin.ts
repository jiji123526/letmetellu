export function isAllowedRequestOrigin(
  origin: string | null,
  allowedOrigins: string
): boolean {
  if (!origin) return false;

  const allowed = allowedOrigins
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return allowed.includes("*") || allowed.includes(origin);
}
