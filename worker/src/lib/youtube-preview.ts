const YOUTUBE_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

function validVideoId(value: string | null | undefined): string | null {
  return value && YOUTUBE_VIDEO_ID.test(value) ? value : null;
}

export function extractYouTubeVideoId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (hostname === "youtu.be" || hostname === "www.youtu.be") {
    return validVideoId(segments[0]);
  }
  const isYouTubeHost = hostname === "youtube.com"
    || hostname.endsWith(".youtube.com")
    || hostname === "youtube-nocookie.com"
    || hostname.endsWith(".youtube-nocookie.com");
  if (!isYouTubeHost) {
    return null;
  }

  if (url.pathname === "/watch") {
    return validVideoId(url.searchParams.get("v"));
  }
  if (["shorts", "live", "embed", "v"].includes(segments[0])) {
    return validVideoId(segments[1]);
  }
  return null;
}
