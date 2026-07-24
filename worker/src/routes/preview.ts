import { Env } from "../types";

export async function handlePreview(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url).searchParams.get("url");

  if (!url) {
    return Response.json({ error: "url parameter required" }, { status: 400 });
  }

  try {
    // YouTube: use noembed for title, return thumbnail directly
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      const videoId = ytMatch[1];
      const oembed = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
      const oembedData = await oembed.json() as { title?: string; author_name?: string };
      return Response.json({
        title: oembedData.title || "",
        description: oembedData.author_name || "",
        image: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        video: "",
        siteName: "YouTube",
        url,
      }, { headers: { "Cache-Control": "public, max-age=3600" } });
    }

    // Twitter/X: use fxtwitter for better OG tags
    let fetchUrl = url;
    if (url.match(/https?:\/\/(twitter\.com|x\.com)\//)) {
      fetchUrl = url.replace(/twitter\.com|x\.com/, "fxtwitter.com");
    }

    const response = await fetch(fetchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept": "text/html",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return Response.json({ error: "fetch failed" }, { status: 502 });
    }

    const html = await response.text();

    // Extract OG meta tags
    const getMetaContent = (property: string): string => {
      const match = html.match(new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"))
        || html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`, "i"))
        || html.match(new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"));
      return match ? match[1] : "";
    };

    const title = getMetaContent("og:title") || getMetaContent("twitter:title") || "";
    const description = getMetaContent("og:description") || getMetaContent("twitter:description") || "";
    const image = getMetaContent("og:image") || getMetaContent("twitter:image") || "";
    let video = getMetaContent("og:video") || getMetaContent("og:video:url") || getMetaContent("twitter:player:stream") || "";
    const siteName = getMetaContent("og:site_name") || "";

    // No video preview for Twitter/X
    if (url.match(/https?:\/\/(twitter\.com|x\.com)\//)) {
      video = "";
    }

    return Response.json({ title, description, image, video, siteName, url }, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return Response.json({ error: "failed to fetch preview" }, { status: 500 });
  }
}
