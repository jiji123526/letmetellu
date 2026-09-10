export interface PreviewMetadata {
  title: string;
  description: string;
  image: string;
  icon: string;
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

function getTagAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(
    /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
  )) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  }
  return attributes;
}

function getDocumentIcon(html: string, baseUrl: string): string {
  const candidates = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => getTagAttributes(match[0]))
    .filter((attributes) => {
      const relations = (attributes.rel || "").toLowerCase().split(/\s+/);
      return relations.some((relation) => (
        relation === "icon"
        || relation === "apple-touch-icon"
        || relation === "apple-touch-icon-precomposed"
      )) && Boolean(attributes.href);
    })
    .map((attributes) => {
      const size = (attributes.sizes || "")
        .split(/\s+/)
        .map((value) => Number(value.match(/^(\d+)x\d+$/i)?.[1] || 0))
        .reduce((largest, value) => Math.max(largest, value), 0);
      return {
        url: resolveHttpUrl(attributes.href, baseUrl),
        size,
      };
    })
    .filter((candidate) => Boolean(candidate.url))
    .sort((left, right) => right.size - left.size);
  return candidates[0]?.url || "";
}

function getUrlIdentityTitle(baseUrl: string): string {
  try {
    const segments = new URL(baseUrl).pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    const first = segments[0] || "";
    if (/^@[\p{L}\p{N}._-]{1,64}$/u.test(first)) return first;

    const profilePrefixes = new Set(["c", "channel", "profile", "profiles", "user", "users"]);
    const identity = profilePrefixes.has(first.toLowerCase()) ? segments[1] || "" : "";
    return /^[\p{L}\p{N}._-]{1,64}$/u.test(identity) ? identity : "";
  } catch {
    return "";
  }
}

export function parsePreviewMetadata(html: string, baseUrl: string): PreviewMetadata {
  const documentTitle = normalizeText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const title = getMetaContent(html, "og:title")
    || getMetaContent(html, "twitter:title")
    || documentTitle
    || getUrlIdentityTitle(baseUrl);
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
  const icon = getDocumentIcon(html, baseUrl);
  let siteName = getMetaContent(html, "og:site_name");
  if (!siteName) {
    try {
      siteName = new URL(baseUrl).hostname.replace(/^www\./, "");
    } catch {}
  }

  return { title, description, image, icon, video, siteName };
}
