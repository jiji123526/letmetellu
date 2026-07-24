import { Env } from "../types";
import { verifyRoomToken } from "./passcode";
import { getChannelPasscodeInfo } from "../lib/validation";

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function handleUpload(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const channelId = new URL(request.url).searchParams.get("channel");
  if (!channelId) return Response.json({ error: "missing channel" }, { status: 400 });

  // Passcode gate
  const parentChannelId = channelId.endsWith("_live") ? channelId.replace(/_live$/, "") : channelId;
  const { passcode } = await getChannelPasscodeInfo(parentChannelId, env);
  if (passcode) {
    const roomToken = request.headers.get("X-Room-Token");
    if (!roomToken) return Response.json({ error: "passcode required" }, { status: 403 });
    const decoded = await verifyRoomToken(roomToken, env);
    if (!decoded || decoded.channel_id !== parentChannelId || decoded.passcode_hash !== passcode) {
      return Response.json({ error: "invalid token" }, { status: 403 });
    }
  }

  const contentType = request.headers.get("Content-Type") || "image/jpeg";

  // Validate content type
  if (!ALLOWED_TYPES.includes(contentType)) {
    return Response.json({ error: "invalid file type" }, { status: 400 });
  }

  // Validate size from Content-Length header
  const contentLength = parseInt(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_UPLOAD_SIZE) {
    return Response.json({ error: "file too large" }, { status: 413 });
  }

  const ext = contentType.includes("png") ? "png" : contentType.includes("gif") ? "gif" : contentType.includes("webp") ? "webp" : "jpg";
  const key = `${channelId}/${crypto.randomUUID()}.${ext}`;

  // Read body with size enforcement (in case Content-Length is spoofed)
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  const reader = request.body!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.byteLength;
    if (totalSize > MAX_UPLOAD_SIZE) {
      reader.cancel();
      return Response.json({ error: "file too large" }, { status: 413 });
    }
    chunks.push(value);
  }

  const blob = new Blob(chunks, { type: contentType });

  await env.MEDIA.put(key, blob, {
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
