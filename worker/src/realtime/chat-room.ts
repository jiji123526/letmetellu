import { Env } from "../types";
import { verifyAdminWsToken, verifyRoomViewerWsToken, verifyViewerWsToken } from "../lib/admin-ws-token";
import { isReportsChannel, isReportsChannelOwner } from "../lib/special-channels";
import { authorizeRoomToken } from "../routes/passcode";
import { advanceChannelRateLimit, type ChannelRateLimitBucket } from "../lib/channel-rate-limit";

interface Connection {
  uid: string;
  channelId: string;
  joinedAt: number;
  isAdmin: boolean;
  viewerOverride: boolean;
  authorized: boolean;
  authAttempt: number;
  inLive: boolean;
}

export class ChatRoom {
  private static readonly PRESENCE_BROADCAST_DEBOUNCE_MS = 150;
  private connections: Map<WebSocket, Connection> = new Map();
  private state: DurableObjectState;
  private env: Env;
  private currentPasscode: string | null = null;
  private passcodeLoaded = false;
  private presenceBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private livePresenceBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPresenceCount = -1;
  private lastLiveCount = -1;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    for (const socket of state.getWebSockets()) {
      const connection = socket.deserializeAttachment() as Connection | null;
      if (connection) this.connections.set(socket, { ...connection, inLive: !!connection.inLive });
    }
  }

  private async ensurePasscode(channelId: string): Promise<boolean> {
    if (this.passcodeLoaded) return true;
    const channel = await this.env.DB.prepare(
      "SELECT passcode FROM channels WHERE id = ?"
    ).bind(channelId).first() as { passcode: string | null } | null;
    if (!channel) return false;
    this.currentPasscode = channel.passcode;
    this.passcodeLoaded = true;
    return true;
  }

  private persistConnection(socket: WebSocket, connection: Connection): void {
    this.connections.set(socket, connection);
    socket.serializeAttachment(connection);
  }

  private async rateLimitStorageKey(subjectKey: string): Promise<string> {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subjectKey))
    );
    const digestHex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return "message-rate:" + digestHex;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const channelId = url.pathname.split("/ws/")[1]?.split("/")[0] || "";
      if (!channelId) return new Response("missing channel", { status: 400 });

      if (!await this.ensurePasscode(channelId)) return new Response("channel not found", { status: 404 });

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const uid = url.searchParams.get("uid") || "anon";
      const connection: Connection = {
        uid,
        channelId,
        joinedAt: Date.now(),
        isAdmin: false,
        viewerOverride: false,
        authorized: isReportsChannel(channelId, this.env) ? false : !this.currentPasscode,
        authAttempt: 0,
        inLive: false,
      };
      server.serializeAttachment(connection);
      this.state.acceptWebSocket(server);
      this.connections.set(server, connection);
      if (!isReportsChannel(channelId, this.env) && !this.currentPasscode) {
        server.send(JSON.stringify({ type: "room-authenticated" }));
      }

      this.queuePresenceBroadcast();

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
        if (connection.isAdmin || connection.viewerOverride) {
          this.persistConnection(ws, connection);
          continue;
        }
        if (this.currentPasscode) {
          if (connection.authorized) {
            try {
              ws.send(JSON.stringify({ type: "room-access-revoked" }));
            } catch {}
          }
          connection.authorized = false;
          connection.inLive = false;
        } else {
          connection.authorized = true;
          try {
            ws.send(JSON.stringify({ type: "room-access-opened" }));
          } catch {}
        }
        this.persistConnection(ws, connection);
      }
      this.queuePresenceBroadcast();
      this.queueLivePresenceBroadcast();
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
      this.currentPasscode = null;
      this.passcodeLoaded = false;
      this.lastPresenceCount = -1;
      this.lastLiveCount = -1;
      return new Response("ok");
    }

    if (url.pathname.endsWith("/message-rate-limit")) {
      const body = await request.json() as { subjectKey?: unknown; limit?: unknown; windowMs?: unknown };
      const subjectKey = typeof body.subjectKey === "string" ? body.subjectKey : "";
      const limit = typeof body.limit === "number" ? Math.floor(body.limit) : 0;
      const windowMs = typeof body.windowMs === "number" ? Math.floor(body.windowMs) : 0;
      if (!subjectKey || subjectKey.length > 512 || limit < 1 || limit > 100 || windowMs < 1_000 || windowMs > 60_000) {
        return Response.json({ error: "invalid rate limit request" }, { status: 400 });
      }
      const storageKey = await this.rateLimitStorageKey(subjectKey);
      const nowMs = Date.now();
      const result = await this.state.storage.transaction(async (transaction) => {
        const previous = await transaction.get<ChannelRateLimitBucket>(storageKey) || null;
        const next = advanceChannelRateLimit(previous, nowMs, windowMs, limit);
        await transaction.put(storageKey, {
          windowStartMs: next.windowStartMs,
          count: next.count,
        } satisfies ChannelRateLimitBucket);
        return next;
      });
      return Response.json({ ok: result.ok, count: result.count, resetAt: result.resetAt });
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
      return Response.json({ count, liveCount: this.liveViewerCount() });
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    const connection = this.connections.get(socket)
      || socket.deserializeAttachment() as Connection | null;
    if (!connection) return;
    this.connections.set(socket, connection);
    try {
      const data = JSON.parse(message) as Record<string, unknown>;
      if (data.type === "auth-room") {
        if (!await this.ensurePasscode(connection.channelId)) {
          socket.close(1008, "channel not found");
          return;
        }
        const authAttempt = ++connection.authAttempt;
        const expectedPasscode = this.currentPasscode;
        const authResponse = (type: string) => JSON.stringify({
          type,
          requestId: typeof data.requestId === "string" ? data.requestId : undefined,
        });
        if (isReportsChannel(connection.channelId, this.env)) {
          connection.authorized = connection.isAdmin;
          socket.send(authResponse(connection.isAdmin ? "room-authenticated" : "room-auth-required"));
        } else if (connection.isAdmin) {
          connection.authorized = true;
          socket.send(authResponse("room-authenticated"));
        } else if (!this.currentPasscode) {
          connection.authorized = true;
          socket.send(authResponse("room-authenticated"));
        } else if (typeof data.token === "string" && data.token) {
          const payload = await authorizeRoomToken(data.token, connection.channelId, this.currentPasscode, this.env);
          if (connection.authAttempt !== authAttempt || this.currentPasscode !== expectedPasscode) return;
          connection.authorized = !!payload;
          socket.send(authResponse(payload ? "room-authenticated" : "room-auth-failed"));
        } else {
          connection.authorized = false;
          socket.send(authResponse("room-auth-required"));
        }
        this.queuePresenceBroadcast();
      }

      if (data.type === "auth-viewer" && typeof data.token === "string") {
        const payload = await verifyViewerWsToken(data.token, this.env);
        const valid = !!payload?.user_id
          && payload.channel_id === connection.channelId
          && await isReportsChannelOwner(payload.user_id, this.env);
        if (valid && payload) {
          connection.authAttempt++;
          connection.uid = payload.user_id;
          connection.viewerOverride = true;
          connection.authorized = true;
        } else {
          connection.viewerOverride = false;
          connection.authorized = false;
        }
        socket.send(JSON.stringify({
          type: valid ? "room-authenticated" : "room-auth-failed",
          requestId: typeof data.requestId === "string" ? data.requestId : undefined,
        }));
        this.queuePresenceBroadcast();
      }

      if (data.type === "auth-room-viewer" && typeof data.token === "string") {
        const payload = await verifyRoomViewerWsToken(data.token, this.env);
        const valid = payload?.channel_id === connection.channelId;
        if (valid && payload) {
          connection.authAttempt++;
          connection.uid = payload.user_id;
          connection.authorized = true;
        } else {
          connection.authorized = false;
        }
        socket.send(JSON.stringify({
          type: valid ? "room-authenticated" : "room-auth-failed",
          requestId: typeof data.requestId === "string" ? data.requestId : undefined,
        }));
        this.queuePresenceBroadcast();
      }

      if ((data.type === "emoji-fx" || data.type === "typing") && connection.authorized) {
        this.broadcast(message);
      }
      if (data.type === "join-live" && connection.authorized) {
        connection.inLive = true;
        this.queueLivePresenceBroadcast();
      }
      if (data.type === "leave-live" && connection.authorized) {
        connection.inLive = false;
        this.queueLivePresenceBroadcast();
      }
      if (data.type === "auth-admin" && typeof data.token === "string") {
        const payload = await verifyAdminWsToken(data.token, this.env);
        if (payload?.channel_id === connection.channelId) {
          connection.authAttempt++;
          connection.uid = payload.user_id;
          connection.isAdmin = true;
          connection.viewerOverride = false;
          connection.authorized = true;
          socket.send(JSON.stringify({ type: "admin-authenticated" }));
          this.queuePresenceBroadcast();
        } else {
          socket.send(JSON.stringify({ type: "admin-auth-failed" }));
        }
      }
    } catch {
      return;
    } finally {
      this.persistConnection(socket, connection);
    }
  }

  webSocketClose(socket: WebSocket): void {
    this.connections.delete(socket);
    this.queuePresenceBroadcast();
    this.queueLivePresenceBroadcast();
  }

  webSocketError(socket: WebSocket): void {
    this.connections.delete(socket);
    this.queuePresenceBroadcast();
    this.queueLivePresenceBroadcast();
  }

  private liveViewerCount(): number {
    return [...this.connections.values()].filter((connection) => connection.authorized && connection.inLive).length;
  }

  private broadcast(message: string) {
    for (const [ws, conn] of this.connections) {
      if (!conn.authorized) continue;
      try {
        ws.send(message);
      } catch {
        this.connections.delete(ws);
      }
    }
  }

  private queuePresenceBroadcast() {
    if (this.presenceBroadcastTimer) return;
    this.presenceBroadcastTimer = setTimeout(() => {
      this.presenceBroadcastTimer = null;
      this.broadcastPresenceNow();
    }, ChatRoom.PRESENCE_BROADCAST_DEBOUNCE_MS);
  }

  private queueLivePresenceBroadcast() {
    if (this.livePresenceBroadcastTimer) return;
    this.livePresenceBroadcastTimer = setTimeout(() => {
      this.livePresenceBroadcastTimer = null;
      this.broadcastLivePresenceNow();
    }, ChatRoom.PRESENCE_BROADCAST_DEBOUNCE_MS);
  }

  private broadcastPresenceNow() {
    const count = [...this.connections.values()].filter((connection) => connection.authorized).length;
    const liveCount = this.liveViewerCount();
    if (count === this.lastPresenceCount && liveCount === this.lastLiveCount) {
      return;
    }
    this.lastPresenceCount = count;
    this.lastLiveCount = liveCount;
    this.broadcast(JSON.stringify({ type: "presence", count, liveCount }));
  }

  private broadcastLivePresenceNow() {
    const liveCount = this.liveViewerCount();
    if (liveCount === this.lastLiveCount) {
      return;
    }
    this.lastLiveCount = liveCount;
    this.broadcast(JSON.stringify({ type: "live-presence", liveCount }));
  }

  private broadcastToAdmin(message: string) {
    for (const [ws, conn] of this.connections) {
      if (!conn.isAdmin || !conn.authorized) continue;
      try {
        ws.send(message);
      } catch {
        this.connections.delete(ws);
      }
    }
  }

  private broadcastPresence() {
    this.queuePresenceBroadcast();
  }

  private broadcastLivePresence() {
    this.queueLivePresenceBroadcast();
  }
}
