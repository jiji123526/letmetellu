export const MAX_MESSAGE_SEARCH_QUERY_LENGTH = 200;
export const MIN_TRIGRAM_SEARCH_QUERY_LENGTH = 3;

export function normalizeMessageSearchQuery(value: string): string {
  return value.trim().slice(0, MAX_MESSAGE_SEARCH_QUERY_LENGTH);
}

export function shouldUseTrigramMessageSearch(value: string): boolean {
  return Array.from(value).length >= MIN_TRIGRAM_SEARCH_QUERY_LENGTH;
}

export function toFts5Phrase(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
