import { Env } from "../types";
import { verifyAdminWsToken, verifyViewerWsToken } from "../lib/admin-ws-token";
import { isReportsChannel, isReportsChannelOwner } from "../lib/special-channels";
import { authorizeRoomToken } from "../routes/passcode";

interface Connection {
  uid: string;
  channelId: string;
  joinedAt: number;
  isAdmin: boolean;
  viewerOverride: boolean;
  authorized: boolean;
  authAttempt: number;
}

export class ChatRoom {
  private connections: Map<WebSocket, Connection> = new Map();
  private liveViewers: Set<WebSocket> = new Set();
  private state: DurableObjectState;
  private env: Env;
  private currentPasscode: string | null = null;
  private passcodeLoaded = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const channelId = url.pathname.split("/ws/")[1]?.split("/")[0] || "";
      if (!channelId) return new Response("missing channel", { status: 400 });

      if (!this.passcodeLoaded) {
        const channel = await this.env.DB.prepare(
          "SELECT passcode FROM channels WHERE id = ?"
        ).bind(channelId).first() as { passcode: string | null } | null;
        if (!channel) return new Response("channel not found", { status: 404 });
        this.currentPasscode = channel.passcode;
        this.passcodeLoaded = true;
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      server.accept();
      const uid = url.searchParams.get("uid") || "anon";
      this.connections.set(server, {
        uid,
        channelId,
        joinedAt: Date.now(),
        isAdmin: false,
        viewerOverride: false,
        authorized: isReportsChannel(channelId, this.env) ? false : !this.currentPasscode,
        authAttempt: 0,
      });

      server.addEventListener("message", async (event) => {
        if (typeof event.data !== "string") return;
        try {
          const data = JSON.parse(event.data);
          const conn = this.connections.get(server);
          if (!conn) return;

          if (data.type === "auth-room") {
            const authAttempt = ++conn.authAttempt;
            const expectedPasscode = this.currentPasscode;
            const authResponse = (type: string) => JSON.stringify({
              type,
              requestId: typeof data.requestId === "string" ? data.requestId : undefined,
            });
            if (isReportsChannel(conn.channelId, this.env)) {
              conn.authorized = conn.isAdmin;
              server.send(authResponse(conn.isAdmin ? "room-authenticated" : "room-auth-required"));
            } else if (conn.isAdmin) {
              conn.authorized = true;
              server.send(authResponse("room-authenticated"));
            } else if (!this.currentPasscode) {
              conn.authorized = true;
              server.send(authResponse("room-authenticated"));
            } else if (typeof data.token === "string" && data.token) {
              const payload = await authorizeRoomToken(data.token, conn.channelId, this.currentPasscode, this.env);
              // A newer token attempt or passcode change supersedes this
              // asynchronous verification result.
              if (
                conn.authAttempt !== authAttempt
                || this.currentPasscode !== expectedPasscode
              ) return;
              if (payload) {
                conn.authorized = true;
                server.send(authResponse("room-authenticated"));
                this.broadcastPresence();
              } else {
                conn.authorized = false;
                server.send(authResponse("room-auth-failed"));
              }
            } else {
              conn.authorized = false;
              server.send(authResponse("room-auth-required"));
            }
          }

          if (data.type === "auth-viewer" && typeof data.token === "string") {
            const payload = await verifyViewerWsToken(data.token, this.env);
            const authResponse = JSON.stringify({
              type: payload?.channel_id === conn.channelId && payload?.user_id ? "room-authenticated" : "room-auth-failed",
              requestId: typeof data.requestId === "string" ? data.requestId : undefined,
            });
            if (payload?.channel_id === conn.channelId && await isReportsChannelOwner(payload.user_id, this.env)) {
              conn.authAttempt++;
              conn.uid = payload.user_id;
              conn.viewerOverride = true;
              conn.authorized = true;
              server.send(authResponse);
              this.broadcastPresence();
            } else {
              conn.viewerOverride = false;
              conn.authorized = false;
              server.send(authResponse);
            }
          }

          if (data.type === "emoji-fx" || data.type === "typing") {
            if (conn.authorized) this.broadcast(event.data);
          }
          if (data.type === "join-live") {
            if (!conn.authorized) return;
            this.liveViewers.add(server);
            this.broadcastLivePresence();
          }
          if (data.type === "leave-live") {
            if (!conn.authorized) return;
            this.liveViewers.delete(server);
            this.broadcastLivePresence();
          }
          // Admin authentication via WebSocket message
          if (data.type === "auth-admin" && typeof data.token === "string") {
            const payload = await verifyAdminWsToken(data.token, this.env);
            if (conn && payload?.channel_id === conn.channelId) {
              // Invalidate any slower room-token verification that began before
              // this admin token succeeded, so it cannot revoke admin access.
              conn.authAttempt++;
              conn.uid = payload.user_id;
              conn.isAdmin = true;
              conn.viewerOverride = false;
              conn.authorized = true;
              server.send(JSON.stringify({ type: "admin-authenticated" }));
              this.broadcastPresence();
            } else {
              server.send(JSON.stringify({ type: "admin-auth-failed" }));
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

    // Revoke existing room-token sessions immediately when the owner changes
    // the passcode. Admin sessions remain authorized by their separate token.
    if (url.pathname.endsWith("/access-policy-changed")) {
      const body = await request.json() as { passcode: string | null };
      const nextPasscode = body.passcode || null;
      if (this.passcodeLoaded && this.currentPasscode === nextPasscode) {
        return new Response("ok");
      }
      this.currentPasscode = nextPasscode;
      this.passcodeLoaded = true;
      for (const [ws, connection] of this.connections) {
        connection.authAttempt++;
        if (connection.isAdmin || connection.viewerOverride) continue;
        if (this.currentPasscode) {
          if (connection.authorized) {
            try {
              ws.send(JSON.stringify({ type: "room-access-revoked" }));
            } catch {}
          }
          connection.authorized = false;
          this.liveViewers.delete(ws);
        } else {
          connection.authorized = true;
          try {
            ws.send(JSON.stringify({ type: "room-access-opened" }));
          } catch {}
        }
      }
      this.broadcastPresence();
      this.broadcastLivePresence();
      return new Response("ok");
    }

    if (url.pathname.endsWith("/channel-deleted")) {
      const event = JSON.stringify({ type: "channel-deleted" });
      for (const ws of this.connections.keys()) {
        try {
          ws.send(event);
          ws.close(1000, "channel deleted");
        } catch {}
      }
      this.connections.clear();
      this.liveViewers.clear();
      this.currentPasscode = null;
      this.passcodeLoaded = false;
      return new Response("ok");
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
      const count = [...this.connections.values()].filter((connection) => connection.authorized).length;
      return Response.json({ count, liveCount: this.liveViewers.size });
    }

    return new Response("not found", { status: 404 });
  }

  private broadcast(message: string) {
    for (const [ws, conn] of this.connections) {
      if (!conn.authorized) continue;
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
      if (!conn.isAdmin || !conn.authorized) continue;
      try {
        ws.send(message);
      } catch {
        this.connections.delete(ws);
        this.liveViewers.delete(ws);
      }
    }
  }

  private broadcastPresence() {
    const count = [...this.connections.values()].filter((connection) => connection.authorized).length;
    this.broadcast(JSON.stringify({ type: "presence", count, liveCount: this.liveViewers.size }));
  }

  private broadcastLivePresence() {
    this.broadcast(JSON.stringify({ type: "live-presence", liveCount: this.liveViewers.size }));
  }
}
