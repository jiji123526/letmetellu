import type { Env } from "./types.ts";
import { handleCanaryChannelCopyPreflight } from "./routes/canary-channel-copy-operations.ts";
import { handleCanaryChannelCopyMutation } from "./routes/canary-channel-copy-mutations.ts";
import { handleCanaryChannelCopyVerification } from "./routes/canary-channel-copy-verification.ts";
import { handleCanaryChannelCopyCleanup } from "./routes/canary-channel-copy-cleanup.ts";

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
      if (pathname === "/internal/d1-canary/copy-preflight") {
        return harden(await handleCanaryChannelCopyPreflight(request, env));
      }
      if (pathname === "/internal/d1-canary/copy") {
        return harden(await handleCanaryChannelCopyMutation(request, env));
      }
      if (pathname === "/internal/d1-canary/copy-verify") {
        return harden(await handleCanaryChannelCopyVerification(request, env));
      }
      if (pathname === "/internal/d1-canary/copy-cleanup") {
        return harden(await handleCanaryChannelCopyCleanup(request, env));
      }
      return harden(Response.json({ error: "not_found" }, { status: 404 }));
    } catch {
      return harden(Response.json(
        { error: "canary_operator_failed" },
        { status: 503 },
      ));
    }
  },
};
