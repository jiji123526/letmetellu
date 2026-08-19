const MESSAGE_PREVIEW_WARM_LIMIT = 2;
const MESSAGE_URL_REGEX = /https?:\/\/[^\s<]+/g;

export function extractMessagePreviewUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const urls = text.match(MESSAGE_URL_REGEX) || [];
  const normalized = urls
    .map((url) => url.replace(/[\])}>.,!?;:'"”’]+$/g, ""))
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, MESSAGE_PREVIEW_WARM_LIMIT);
}
