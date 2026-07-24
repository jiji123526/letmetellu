import { Env } from "../types";

interface Connection {
  uid: string;
  joinedAt: number;
}

export class ChatRoom {
  private connections: Map<WebSocket, Connection> = new Map();
  private liveViewers: Set<WebSocket> = new Set();
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      server.accept();
      const uid = url.searchParams.get("uid") || "anon";
      this.connections.set(server, { uid, joinedAt: Date.now() });

      server.addEventListener("message", (event) => {
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
      const event = await request.json();
      this.broadcast(JSON.stringify(event));
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

  private broadcastPresence() {
    this.broadcast(JSON.stringify({ type: "presence", count: this.connections.size, liveCount: this.liveViewers.size }));
  }

  private broadcastLivePresence() {
    this.broadcast(JSON.stringify({ type: "live-presence", liveCount: this.liveViewers.size }));
  }
}
