import { Env } from "./types";
import { ChatRoom } from "./realtime/chat-room";
import { handleMessages } from "./routes/messages";
import { handleData } from "./routes/data";
import { handleInit } from "./routes/init";
import { handleAdmin } from "./routes/admin";
import { handleUser } from "./routes/user";
import { handleAuth } from "./routes/auth";
import { handleDm } from "./routes/dm";

export { ChatRoom };

function corsHeaders(origin: string, allowedOrigin: string): HeadersInit {
  const allowed = allowedOrigin.split(",").map((s) => s.trim());
  const isAllowed = allowed.includes(origin) || allowed.includes("*");
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Internal-Token, X-User-Id",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env.ALLOWED_ORIGIN),
      });
    }

    // WebSocket upgrade → route to Durable Object
    if (url.pathname.startsWith("/ws/")) {
      const channelId = url.pathname.split("/ws/")[1];
      if (!channelId) return new Response("missing channel", { status: 400 });

      const doId = env.CHAT_ROOM.idFromName(channelId);
      const stub = env.CHAT_ROOM.get(doId);
      return stub.fetch(request);
    }

    // API routes
    let response: Response;

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
      } else if (url.pathname.startsWith("/api/auth")) {
        response = await handleAuth(request, env);
      } else if (url.pathname.startsWith("/api/dm")) {
        response = await handleDm(request, env);
      } else {
        response = new Response("not found", { status: 404 });
      }
    } catch (err) {
      console.error(err);
      response = new Response("internal error", { status: 500 });
    }

    // Attach CORS headers to response
    const headers = new Headers(response.headers);
    Object.entries(corsHeaders(origin, env.ALLOWED_ORIGIN)).forEach(([k, v]) => {
      headers.set(k, v);
    });

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  },
};
