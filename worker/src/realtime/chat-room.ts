import { Env } from "../types";
import { verifyAdminWsToken } from "../lib/admin-ws-token";

interface Connection {
  uid: string;
  channelId: string;
  joinedAt: number;
  isAdmin: boolean;
}

export class ChatRoom {
  private connections: Map<WebSocket, Connection> = new Map();
  private liveViewers: Set<WebSocket> = new Set();
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      server.accept();
      const uid = url.searchParams.get("uid") || "anon";
      const channelId = url.pathname.split("/ws/")[1]?.split("/")[0] || "";
      this.connections.set(server, { uid, channelId, joinedAt: Date.now(), isAdmin: false });

      server.addEventListener("message", async (event) => {
        if (typeof event.data !== "string") return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "emoji-fx" || data.type === "typing") {
            this.broadcast(event.data);
          }
          if (data.type === "join-live") {
            this.liveViewers.add(server);
            this.broadcastLivePresence();
          }
          if (data.type === "leave-live") {
            this.liveViewers.delete(server);
            this.broadcastLivePresence();
          }
          // Admin authentication via WebSocket message
          if (data.type === "auth-admin" && typeof data.token === "string") {
            const conn = this.connections.get(server);
            const payload = await verifyAdminWsToken(data.token, this.env);
            if (conn && payload?.channel_id === conn.channelId) {
              conn.uid = payload.user_id;
              conn.isAdmin = true;
            }
          }
        } catch {}
      });

      server.addEventListener("close", () => {
        this.connections.delete(server);
        this.liveViewers.delete(server);
        this.broadcastPresence();
        this.broadcastLivePresence();
      });

      server.addEventListener("error", () => {
        this.connections.delete(server);
        this.liveViewers.delete(server);
        this.broadcastPresence();
        this.broadcastLivePresence();
      });

      this.broadcastPresence();

      return new Response(null, { status: 101, webSocket: client });
    }

    // Internal broadcast trigger (from Worker routes after D1 write)
    if (url.pathname.endsWith("/broadcast")) {
      const event = await request.json() as Record<string, unknown>;
      const eventStr = JSON.stringify(event);
      const isDmEvent = event.type === "dm-new" || event.type === "dm-deleted";

      if (isDmEvent) {
        // Only send DM events to authenticated admin connections
        this.broadcastToAdmin(eventStr);
      } else {
        this.broadcast(eventStr);
      }
      return new Response("ok");
    }

    // Presence query
    if (url.pathname.endsWith("/presence")) {
      return Response.json({ count: this.connections.size, liveCount: this.liveViewers.size });
    }

    return new Response("not found", { status: 404 });
  }

  private broadcast(message: string) {
    for (const [ws] of this.connections) {
      try {
        ws.send(message);
      } catch {
        this.connections.delete(ws);
        this.liveViewers.delete(ws);
      }
    }
  }

  private broadcastToAdmin(message: string) {
    for (const [ws, conn] of this.connections) {
      if (!conn.isAdmin) continue;
      try {
        ws.send(message);
      } catch {
        this.connections.delete(ws);
        this.liveViewers.delete(ws);
      }
    }
  }

  private broadcastPresence() {
    this.broadcast(JSON.stringify({ type: "presence", count: this.connections.size, liveCount: this.liveViewers.size }));
  }

  private broadcastLivePresence() {
    this.broadcast(JSON.stringify({ type: "live-presence", liveCount: this.liveViewers.size }));
  }
}
