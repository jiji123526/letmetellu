import { Env } from "../types";

export async function handleUpload(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const contentType = request.headers.get("Content-Type") || "";

  // Accept base64 JSON body
  if (contentType.includes("application/json")) {
    const body = await request.json() as { data: string; channel_id: string; filename?: string };
    const { data, channel_id, filename } = body;

    if (!data || !channel_id) {
      return Response.json({ error: "missing data or channel_id" }, { status: 400 });
    }

    // Parse base64 data URL
    const match = data.match(/^data:(.+);base64,(.+)$/);
    if (!match) return Response.json({ error: "invalid data URL" }, { status: 400 });

    const mimeType = match[1];
    const base64 = match[2];
    const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    const ext = mimeType.split("/")[1] || "jpg";
    const key = `${channel_id}/${crypto.randomUUID()}.${ext}`;

    await env.MEDIA.put(key, binary, {
      httpMetadata: { contentType: mimeType },
    });

    // R2 public URL (requires public access enabled on bucket, or use Worker to serve)
    const url = `https://letmetellu-media.${env.ALLOWED_ORIGIN.includes("localhost") ? "localhost" : "r2.cloudflarestorage.com"}/${key}`;

    // For now, serve via Worker — we'll add a /media/:key route
    const serveUrl = `/api/media/${key}`;

    return Response.json({ ok: true, key, url: serveUrl });
  }

  return Response.json({ error: "unsupported content type" }, { status: 400 });
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
