import { Env } from "../types";

export async function handleUpload(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const channelId = new URL(request.url).searchParams.get("channel");
  if (!channelId) return Response.json({ error: "missing channel" }, { status: 400 });

  const contentType = request.headers.get("Content-Type") || "image/jpeg";
  const ext = contentType.includes("png") ? "png" : contentType.includes("gif") ? "gif" : contentType.includes("webp") ? "webp" : "jpg";
  const key = `${channelId}/${crypto.randomUUID()}.${ext}`;

  // Store raw binary directly to R2
  await env.MEDIA.put(key, request.body!, {
    httpMetadata: { contentType },
  });

  return Response.json({ ok: true, key, url: `/api/media/${key}` });
}

// Serve uploaded media
export async function handleMediaServe(request: Request, env: Env, key: string): Promise<Response> {
  const object = await env.MEDIA.get(key);
  if (!object) return new Response("not found", { status: 404 });

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
}
