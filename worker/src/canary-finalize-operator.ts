import type { Env } from "./types.ts";
import { handleCanaryMessageDelta } from "./routes/canary-message-delta.ts";

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
    const pathname = new URL(request.url).pathname;
    try {
      if (pathname === "/internal/d1-canary/message-delta") {
        return harden(await handleCanaryMessageDelta(request, env));
      }
      return harden(Response.json({ error: "not_found" }, { status: 404 }));
    } catch {
      return harden(Response.json(
        { error: "canary_finalize_operator_failed" },
        { status: 503 },
      ));
    }
  },
};
