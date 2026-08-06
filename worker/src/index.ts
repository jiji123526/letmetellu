import { Env } from "./types";
import { ChatRoom } from "./realtime/chat-room";
import { handleMessages } from "./routes/messages";
import { handleData } from "./routes/data";
import { handleInit } from "./routes/init";
import { handleAdmin } from "./routes/admin";
import { handleUser } from "./routes/user";
import { handleAuth } from "./routes/auth";
import { handleDm } from "./routes/dm";
import { handleUpload, handleMediaServe } from "./routes/upload";
import { handlePreview } from "./routes/preview";
import { handleVerifyPasscode } from "./routes/passcode";
import { handleRecentChannels } from "./routes/recent-channels";
import { handleChannelReports } from "./routes/channel-reports";
import { handlePlatformSupport, handleSupport } from "./routes/support";
import { handleSurvey } from "./routes/survey";
import { recordOperationalEvent } from "./lib/operational-events";
import { runScheduledMaintenance } from "./lib/maintenance";
import { isAllowedRequestOrigin } from "./lib/request-origin";

export { ChatRoom };

function corsHeaders(origin: string, allowedOrigin: string): HeadersInit {
  const isAllowed = isAllowedRequestOrigin(origin, allowedOrigin);
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Internal-Token, X-User-Id, X-Room-Token, X-Anonymous-Token, X-Device-Token",
    "Access-Control-Max-Age": "86400",
  };
}

function securityHeaders(request: Request): HeadersInit {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    "X-Frame-Options": "DENY",
  };
  if (new URL(request.url).protocol === "https:") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload";
  }
  return headers;
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("Vary");
  if (!existing) {
    headers.set("Vary", value);
    return;
  }
  const values = existing.split(",").map((entry) => entry.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) {
    headers.set("Vary", `${existing}, ${value}`);
  }
}

function buildResponse(request: Request, response: Response, origin: string, allowedOrigin: string): Response {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(origin, allowedOrigin)).forEach(([key, value]) => {
    if (value) headers.set(key, value);
    else headers.delete(key);
  });
  Object.entries(securityHeaders(request)).forEach(([key, value]) => {
    headers.set(key, value);
  });
  appendVary(headers, "Origin");

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const route = `${request.method} ${url.pathname}`;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return buildResponse(request, new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env.ALLOWED_ORIGIN),
      }), origin, env.ALLOWED_ORIGIN);
    }

    // WebSocket upgrade → route to Durable Object
    if (url.pathname.startsWith("/ws/")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("websocket upgrade required", { status: 426 });
      }
      if (!isAllowedRequestOrigin(request.headers.get("Origin"), env.ALLOWED_ORIGIN)) {
        return new Response("forbidden origin", { status: 403 });
      }
      const channelId = url.pathname.split("/ws/")[1];
      if (!channelId) return new Response("missing channel", { status: 400 });

      const doId = env.CHAT_ROOM.idFromName(channelId);
      const stub = env.CHAT_ROOM.get(doId);
      return stub.fetch(request);
    }

    // API routes
    let response: Response;
    let capturedUnhandledException = false;

    try {
      if (url.pathname.startsWith("/api/messages")) {
        response = await handleMessages(request, env);
      } else if (url.pathname.startsWith("/api/data")) {
        response = await handleData(request, env);
      } else if (url.pathname.startsWith("/api/init")) {
        response = await handleInit(request, env);
      } else if (url.pathname.startsWith("/api/admin")) {
        response = await handleAdmin(request, env);
      } else if (url.pathname.startsWith("/api/user")) {
        response = await handleUser(request, env);
      } else if (url.pathname.startsWith("/api/recent-channels")) {
        response = await handleRecentChannels(request, env);
      } else if (url.pathname.startsWith("/api/auth")) {
        response = await handleAuth(request, env);
      } else if (url.pathname.startsWith("/api/dm")) {
        response = await handleDm(request, env);
      } else if (url.pathname.startsWith("/api/upload")) {
        response = await handleUpload(request, env);
      } else if (url.pathname.startsWith("/api/preview")) {
        response = await handlePreview(request, env);
      } else if (url.pathname.startsWith("/api/verify-passcode")) {
        response = await handleVerifyPasscode(request, env);
      } else if (url.pathname.startsWith("/api/channel-reports")) {
        response = await handleChannelReports(request, env);
      } else if (url.pathname.startsWith("/api/platform-admin/support")) {
        response = await handlePlatformSupport(request, env);
      } else if (url.pathname.startsWith("/api/support")) {
        response = await handleSupport(request, env);
      } else if (url.pathname.startsWith("/api/survey")) {
        response = await handleSurvey(request, env);
      } else if (url.pathname.startsWith("/api/media/")) {
        const key = url.pathname.replace("/api/media/", "");
        response = await handleMediaServe(request, env, key, ctx);
      } else {
        response = new Response("not found", { status: 404 });
      }
    } catch (err) {
      console.error(err);
      capturedUnhandledException = true;
      ctx.waitUntil(recordOperationalEvent({
        env,
        severity: "error",
        route,
        eventType: "unhandled_exception",
        statusCode: 500,
        actorUserId: request.headers.get("X-User-Id"),
        detail: {
          path: url.pathname,
          method: request.method,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
      response = Response.json({ error: "internal_error" }, { status: 500 });
    }

    if (response.status === 429) {
      ctx.waitUntil(recordOperationalEvent({
        env,
        severity: "warn",
        route,
        eventType: "rate_limited",
        statusCode: response.status,
        actorUserId: request.headers.get("X-User-Id"),
      }));
    } else if (response.status === 403) {
      ctx.waitUntil(recordOperationalEvent({
        env,
        severity: "warn",
        route,
        eventType: "forbidden",
        statusCode: response.status,
        actorUserId: request.headers.get("X-User-Id"),
      }));
    } else if (response.status >= 500) {
      ctx.waitUntil(recordOperationalEvent({
        env,
        severity: "error",
        route,
        eventType: "request_failed",
        statusCode: response.status,
        actorUserId: request.headers.get("X-User-Id"),
        detail: capturedUnhandledException ? { source: "unhandled_exception" } : undefined,
      }));
    }

    return buildResponse(request, response, origin, env.ALLOWED_ORIGIN);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        await runScheduledMaintenance(env);
      } catch (error) {
        console.error("scheduled maintenance failed", error);
        await recordOperationalEvent({
          env,
          severity: "error",
          route: "scheduled maintenance",
          eventType: "maintenance_failed",
          detail: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    })());
  },
};
