export function buildMessageSearchQuery(value: string): string {
  return value
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll("\"", "\"\"")}"*`)
    .join(" AND ");
}
