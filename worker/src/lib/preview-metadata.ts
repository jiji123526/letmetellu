export interface PreviewMetadata {
  title: string;
  description: string;
  image: string;
  video: string;
  siteName: string;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function normalizeText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getMetaContent(html: string, property: string): string {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<meta[^>]*property=["']${escapedProperty}["'][^>]*content=["']([^"']*)["']`, "i"))
    || html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${escapedProperty}["']`, "i"))
    || html.match(new RegExp(`<meta[^>]*name=["']${escapedProperty}["'][^>]*content=["']([^"']*)["']`, "i"))
    || html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${escapedProperty}["']`, "i"));
  return normalizeText(match?.[1] || "");
}

function resolveHttpUrl(value: string, baseUrl: string): string {
  if (!value) return "";
  try {
    const resolved = new URL(decodeHtmlEntities(value), baseUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : "";
  } catch {
    return "";
  }
}

export function parsePreviewMetadata(html: string, baseUrl: string): PreviewMetadata {
  const documentTitle = normalizeText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const title = getMetaContent(html, "og:title")
    || getMetaContent(html, "twitter:title")
    || documentTitle;
  const description = getMetaContent(html, "og:description")
    || getMetaContent(html, "twitter:description")
    || getMetaContent(html, "description");
  const image = resolveHttpUrl(
    getMetaContent(html, "og:image") || getMetaContent(html, "twitter:image"),
    baseUrl,
  );
  const video = resolveHttpUrl(
    getMetaContent(html, "og:video")
      || getMetaContent(html, "og:video:url")
      || getMetaContent(html, "twitter:player:stream"),
    baseUrl,
  );
  let siteName = getMetaContent(html, "og:site_name");
  if (!siteName && (title || image)) {
    try {
      siteName = new URL(baseUrl).hostname.replace(/^www\./, "");
    } catch {}
  }

  return { title, description, image, video, siteName };
}
