export const MAX_MESSAGE_SEARCH_QUERY_LENGTH = 200;

export function normalizeMessageSearchQuery(value: string): string {
  return value.trim().slice(0, MAX_MESSAGE_SEARCH_QUERY_LENGTH);
}
