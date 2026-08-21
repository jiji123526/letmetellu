import { Env } from "./types";
import { ChatRoom } from "./realtime/chat-room";
import { handleMessages } from "./routes/messages";
import { handleData } from "./routes/data";
import { handleInit } from "./routes/init";
import { handleChannelState } from "./routes/channel-state";
import { handleAdmin } from "./routes/admin";
import { handleUser } from "./routes/user";
import { handleSocketAuth } from "./routes/socket-auth";
import { handleAuth } from "./routes/auth";
import { handleDm } from "./routes/dm";
import { handleUpload, handleMediaServe } from "./routes/upload";
import { handlePreview, warmMessagePreviewCache } from "./routes/preview";
import { handleVerifyPasscode } from "./routes/passcode";
import { handleRecentChannels } from "./routes/recent-channels";
import { handleUnifiedTimeline } from "./routes/unified-timeline";
import { handleChannelReports } from "./routes/channel-reports";
import { handlePlatformSupport, handleSupport } from "./routes/support";
import { handleSurvey } from "./routes/survey";
import { handleBilling } from "./routes/billing";
import {
  getOperationalRouteDetail,
  getOperationalErrorDetail,
  getOperationalEventOverride,
  isTransientD1Error,
  isTransientDurableObjectError,
  normalizeOperationalRoute,
  recordOperationalEvent,
  stripOperationalEventHeaders,
  withOperationalErrorContext,
} from "./lib/operational-events";
import { runScheduledMaintenance } from "./lib/maintenance";
import { runOperationalHealthAlerts } from "./lib/operational-alerts";
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
  stripOperationalEventHeaders(headers);
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

interface TransientInfrastructureFailure {
  clientError: "d1_unavailable" | "realtime_unavailable";
  dependency: "d1" | "durable_object";
  eventType: "d1_unavailable" | "realtime_unavailable";
  logLabel: string;
}

function classifyTransientInfrastructureFailure(error: unknown): TransientInfrastructureFailure | null {
  if (isTransientDurableObjectError(error)) {
    return {
      clientError: "realtime_unavailable",
      dependency: "durable_object",
      eventType: "realtime_unavailable",
      logLabel: "transient Durable Object failure",
    };
  }
  if (isTransientD1Error(error)) {
    return {
      clientError: "d1_unavailable",
      dependency: "d1",
      eventType: "d1_unavailable",
      logLabel: "transient D1 failure",
    };
  }
  return null;
}

async function handleInitWithRetry(request: Request, env: Env): Promise<Response> {
  try {
    return await handleInit(request, env);
  } catch (error) {
    if (!isTransientD1Error(error)) throw error;
  }

  try {
    return await handleInit(request, env);
  } catch (retryError) {
    throw withOperationalErrorContext(retryError, {
      transient_retry_attempted: true,
      transient_retry_count: 1,
      transient_retry_route: "GET /api/init",
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const route = normalizeOperationalRoute(request.method, url.pathname);
    const routeDetail = getOperationalRouteDetail(url.pathname);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return buildResponse(request, new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env.ALLOWED_ORIGIN),
      }), origin, env.ALLOWED_ORIGIN);
    }

    // WebSocket upgrade → route to Durable Object
    if (url.pathname.startsWith("/ws/")) {
      let response: Response;
      let capturedException = false;

      try {
        if (request.headers.get("Upgrade") !== "websocket") {
          response = new Response("websocket upgrade required", { status: 426 });
        } else if (!isAllowedRequestOrigin(request.headers.get("Origin"), env.ALLOWED_ORIGIN)) {
          response = new Response("forbidden origin", { status: 403 });
        } else {
          const channelId = url.pathname.split("/ws/")[1];
          if (!channelId) {
            response = new Response("missing channel", { status: 400 });
          } else {
            const doId = env.CHAT_ROOM.idFromName(channelId);
            const stub = env.CHAT_ROOM.get(doId);
            response = await stub.fetch(request);
          }
        }
      } catch (err) {
        const transientFailure = classifyTransientInfrastructureFailure(err);
        if (transientFailure) console.warn(transientFailure.logLabel, err);
        else console.error(err);
        capturedException = true;
        const operationalDetail = getOperationalErrorDetail(err);
        ctx.waitUntil(recordOperationalEvent({
          env,
          severity: transientFailure ? "warn" : "error",
          route,
          eventType: transientFailure?.eventType || "unhandled_exception",
          statusCode: transientFailure ? 503 : 500,
          actorUserId: request.headers.get("X-User-Id"),
          detail: {
            path: url.pathname,
            method: request.method,
            error: err instanceof Error ? err.message : String(err),
            websocket_phase: "upgrade",
            ...(transientFailure ? { dependency: transientFailure.dependency } : {}),
            ...(routeDetail || {}),
            ...(operationalDetail || {}),
          },
        }));
        return buildResponse(
          request,
          Response.json(
            { error: transientFailure?.clientError || "internal_error" },
            { status: transientFailure ? 503 : 500 },
          ),
          origin,
          env.ALLOWED_ORIGIN,
        );
      }

      if (response.status === 403) {
        ctx.waitUntil(recordOperationalEvent({
          env,
          severity: "warn",
          route,
          eventType: "forbidden",
          statusCode: response.status,
          actorUserId: request.headers.get("X-User-Id"),
          detail: routeDetail || undefined,
        }));
      } else if (response.status >= 500 && !capturedException) {
        ctx.waitUntil(recordOperationalEvent({
          env,
          severity: "error",
          route,
          eventType: getOperationalEventOverride(response) || "request_failed",
          statusCode: response.status,
          actorUserId: request.headers.get("X-User-Id"),
          detail: routeDetail || undefined,
        }));
      }

      if (response.status === 101) {
        return response;
      }

      return buildResponse(request, response, origin, env.ALLOWED_ORIGIN);
    }

    // API routes
    let response: Response;
    let capturedException = false;

    try {
      if (url.pathname.startsWith("/api/messages")) {
        response = await handleMessages(
          request,
          env,
          ctx,
          (sourceRequest, text) => warmMessagePreviewCache(sourceRequest, env, text),
        );
      } else if (url.pathname.startsWith("/api/unified-timeline")) {
        response = await handleUnifiedTimeline(request, env);
      } else if (url.pathname.startsWith("/api/data")) {
        response = await handleData(request, env);
      } else if (url.pathname.startsWith("/api/init")) {
        response = await handleInitWithRetry(request, env);
      } else if (url.pathname.startsWith("/api/channel-state")) {
        response = await handleChannelState(request, env);
      } else if (url.pathname.startsWith("/api/admin")) {
        response = await handleAdmin(request, env);
      } else if (url.pathname.startsWith("/api/user")) {
        response = await handleUser(request, env);
      } else if (url.pathname.startsWith("/api/socket-auth")) {
        response = await handleSocketAuth(request, env);
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
      } else if (url.pathname.startsWith("/api/billing")) {
        response = await handleBilling(request, env);
      } else if (url.pathname.startsWith("/api/media/")) {
        const key = url.pathname.replace("/api/media/", "");
        response = await handleMediaServe(request, env, key, ctx);
      } else {
        response = new Response("not found", { status: 404 });
      }
    } catch (err) {
      const transientFailure = classifyTransientInfrastructureFailure(err);
      if (transientFailure) console.warn(transientFailure.logLabel, err);
      else console.error(err);
      capturedException = true;
      const operationalDetail = getOperationalErrorDetail(err);
      ctx.waitUntil(recordOperationalEvent({
        env,
        severity: transientFailure ? "warn" : "error",
        route,
        eventType: transientFailure?.eventType || "unhandled_exception",
        statusCode: transientFailure ? 503 : 500,
        actorUserId: request.headers.get("X-User-Id"),
        detail: {
          path: url.pathname,
          method: request.method,
          error: err instanceof Error ? err.message : String(err),
          ...(transientFailure ? { dependency: transientFailure.dependency } : {}),
          ...(routeDetail || {}),
          ...(operationalDetail || {}),
        },
      }));
      response = Response.json(
        { error: transientFailure?.clientError || "internal_error" },
        { status: transientFailure ? 503 : 500 },
      );
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
    } else if (response.status === 404 && route === "GET /api/media/:key") {
      ctx.waitUntil(recordOperationalEvent({
        env,
        severity: "info",
        route,
        eventType: "media_not_found",
        statusCode: response.status,
        actorUserId: request.headers.get("X-User-Id"),
        detail: routeDetail || undefined,
      }));
    } else if (response.status === 403) {
      ctx.waitUntil(recordOperationalEvent({
        env,
        severity: "warn",
        route,
        eventType: "forbidden",
        statusCode: response.status,
        actorUserId: request.headers.get("X-User-Id"),
        detail: routeDetail || undefined,
      }));
    } else if (response.status >= 500 && !capturedException) {
      ctx.waitUntil(recordOperationalEvent({
        env,
        severity: "error",
        route,
        eventType: getOperationalEventOverride(response) || "request_failed",
        statusCode: response.status,
        actorUserId: request.headers.get("X-User-Id"),
        detail: routeDetail || undefined,
      }));
    }

    return buildResponse(request, response, origin, env.ALLOWED_ORIGIN);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === "17 * * * *") {
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
    }

    ctx.waitUntil((async () => {
      try {
        await runOperationalHealthAlerts(env);
      } catch (error) {
        console.error("operational health alert evaluation failed", error);
        await recordOperationalEvent({
          env,
          severity: "error",
          route: "scheduled operational health alert",
          eventType: "operational_alert_delivery_failed",
          detail: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    })());
  },
};
