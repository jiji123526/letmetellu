import type { Env } from "./types.ts";
import { handleCanaryChannelCopyPreflight } from "./routes/canary-channel-copy-operations.ts";

function harden(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.delete("Access-Control-Allow-Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/internal/d1-canary/copy-preflight") {
      return harden(Response.json({ error: "not_found" }, { status: 404 }));
    }
    try {
      return harden(await handleCanaryChannelCopyPreflight(request, env));
    } catch {
      return harden(Response.json(
        { error: "canary_preflight_failed" },
        { status: 503 },
      ));
    }
  },
};
