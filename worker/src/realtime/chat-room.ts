import { Env } from "../types";

interface Connection {
  uid: string;
  joinedAt: number;
}

export class ChatRoom {
  private connections: Map<WebSocket, Connection> = new Map();
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

      this.state.acceptWebSocket(server);
      const uid = url.searchParams.get("uid") || "anon";
      this.connections.set(server, { uid, joinedAt: Date.now() });

      this.broadcastPresence();

      return new Response(null, { status: 101, webSocket: client });
    }

    // Internal broadcast trigger (called by Worker routes after D1 write)
    if (url.pathname.endsWith("/broadcast")) {
      const event = await request.json();
      this.broadcast(JSON.stringify(event));
      return new Response("ok");
    }

    // Presence query
    if (url.pathname.endsWith("/presence")) {
      return Response.json({ count: this.connections.size });
    }

    return new Response("not found", { status: 404 });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;

    try {
      const data = JSON.parse(message);
      // Keep-alive ping → respond with pong (don't broadcast)
      if (data.type === "ping") {
        try { ws.send(JSON.stringify({ type: "pong" })); } catch {}
        return;
      }
      // Relay ephemeral events (typing, emoji-fx) to all clients
      if (data.type === "emoji-fx" || data.type === "typing") {
        this.broadcast(message);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  webSocketClose(ws: WebSocket) {
    this.connections.delete(ws);
    this.broadcastPresence();
  }

  webSocketError(ws: WebSocket) {
    this.connections.delete(ws);
    this.broadcastPresence();
  }

  private broadcast(message: string) {
    for (const [ws] of this.connections) {
      try {
        ws.send(message);
      } catch {
        this.connections.delete(ws);
      }
    }
  }

  private broadcastPresence() {
    this.broadcast(JSON.stringify({ type: "presence", count: this.connections.size }));
  }
}
