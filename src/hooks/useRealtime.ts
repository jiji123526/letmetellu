"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { getWebSocketUrl } from "@/lib/api-chat";
import {
  finishChatPerformanceRequest,
  incrementChatReconnectAttempt,
  markChatSocketSynchronized,
  startChatPerformanceCycle,
  startChatPerformanceRequest,
} from "@/lib/chat-performance";

type MessageHandler = (event: { type: string; [key: string]: unknown }) => void;

const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 30 * 1000;
const RECONNECT_JITTER_RATIO = 0.25;
const HIDDEN_SOCKET_SLEEP_MS = 90 * 1000;
const RECONNECT_NOTICE_DELAY_MS = 3000;

function reconnectDelay(attempt: number) {
  const exponentialDelay = Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_BASE_DELAY_MS * (2 ** attempt),
  );
  const jitter = 1 + ((Math.random() * 2 - 1) * RECONNECT_JITTER_RATIO);
  return Math.round(exponentialDelay * jitter);
}

export function useRealtime(
  channelId: string | null,
  uid: string,
  authenticatedUserId: string | null,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const [socketConnected, setSocketConnected] = useState(false);
  const [roomAuthenticated, setRoomAuthenticated] = useState(false);
  const [showReconnectNotice, setShowReconnectNotice] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectNoticeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const connectRef = useRef<() => void>(() => {});
  const sleepTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRoomAuthRequest = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const sleepingRef = useRef(false);
  const hasSynchronizedRef = useRef(false);
  const reconnectTraceIdRef = useRef<string | null>(null);

  const requestSocketAuthorization = useCallback(async (socket: WebSocket) => {
    if (!channelId) return;
    const reconnectTraceId = reconnectTraceIdRef.current;
    if (reconnectTraceId) {
      startChatPerformanceRequest(channelId, reconnectTraceId, "ws-token");
    }
    try {
      const expectedAuthentication = authenticatedUserId ? "1" : "0";
      const response = await fetch(
        `/api/ws-token?channel=${encodeURIComponent(channelId)}&authenticated=${expectedAuthentication}`,
        {
          cache: "no-store",
        },
      );
      if (socket !== wsRef.current || socket.readyState !== WebSocket.OPEN) return;
      if (response.status === 204) return;
      if (!response.ok) return;
      const data = await response.json() as { token?: string; mode?: "admin" | "viewer" | "room" };
      if (!data.token) return;
      const requestId = crypto.randomUUID();
      latestRoomAuthRequest.current = requestId;
      if (data.mode === "admin") {
        socket.send(JSON.stringify({ type: "auth-admin", token: data.token, requestId }));
      } else if (data.mode === "viewer") {
        socket.send(JSON.stringify({ type: "auth-viewer", token: data.token, requestId }));
      } else if (data.mode === "room") {
        socket.send(JSON.stringify({ type: "auth-room-viewer", token: data.token, requestId }));
      }
    } catch {
      // The next reconnect or room-access change will retry.
    } finally {
      if (reconnectTraceId) {
        finishChatPerformanceRequest(channelId, reconnectTraceId, "ws-token");
      }
    }
  }, [authenticatedUserId, channelId]);

  const clearReconnectTimeout = useCallback(() => {
    if (!reconnectTimeout.current) return;
    clearTimeout(reconnectTimeout.current);
    reconnectTimeout.current = null;
  }, []);

  const clearReconnectNotice = useCallback(() => {
    if (reconnectNoticeTimeout.current) {
      clearTimeout(reconnectNoticeTimeout.current);
      reconnectNoticeTimeout.current = null;
    }
    setShowReconnectNotice(false);
  }, []);

  const scheduleReconnectNotice = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (reconnectNoticeTimeout.current) return;
    reconnectNoticeTimeout.current = setTimeout(() => {
      reconnectNoticeTimeout.current = null;
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        setShowReconnectNotice(true);
      }
    }, RECONNECT_NOTICE_DELAY_MS);
  }, []);

  const clearSleepTimeout = useCallback(() => {
    if (!sleepTimeout.current) return;
    clearTimeout(sleepTimeout.current);
    sleepTimeout.current = null;
  }, []);

  const closeSocket = useCallback((reason: "sleep" | "cleanup") => {
    const socket = wsRef.current;
    if (!socket) return;
    intentionalCloseRef.current = true;
    if (reason === "sleep") {
      sleepingRef.current = true;
    }
    wsRef.current = null;
    try {
      socket.close(1000, reason === "sleep" ? "tab hidden idle" : "cleanup");
    } catch {}
  }, []);

  const connect = useCallback(() => {
    if (!channelId) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      sleepingRef.current = true;
      return;
    }

    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    clearReconnectTimeout();

    const url = getWebSocketUrl(channelId, uid);
    if (!url) {
      // Mock mode — no WebSocket
      setSocketConnected(true);
      setRoomAuthenticated(true);
      return;
    }

    sleepingRef.current = false;
    intentionalCloseRef.current = false;
    const ws = new WebSocket(url);
    let synchronized = false;
    wsRef.current = ws;

    const notifySynchronized = () => {
      if (synchronized) return;
      synchronized = true;
      reconnectAttemptRef.current = 0;
      const reconnectTraceId = hasSynchronizedRef.current ? reconnectTraceIdRef.current : null;
      const type = hasSynchronizedRef.current ? "reconnected" : "connected";
      hasSynchronizedRef.current = true;
      if (channelId && reconnectTraceId) {
        markChatSocketSynchronized(channelId, reconnectTraceId);
      }
      clearReconnectNotice();
      handlersRef.current.forEach((handler) => handler(
        reconnectTraceId ? { type, traceCycleId: reconnectTraceId } : { type },
      ));
      reconnectTraceIdRef.current = null;
    };

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setSocketConnected(true);
      setRoomAuthenticated(false);
      handlersRef.current.forEach((handler) => handler({ type: "socket-opened" }));
      void requestSocketAuthorization(ws);
    };

    ws.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(e.data);
        if (
          (
            data.type === "room-authenticated"
            || data.type === "room-auth-failed"
            || data.type === "room-auth-required"
          )
          && data.requestId
          && data.requestId !== latestRoomAuthRequest.current
        ) {
          return;
        }
        if (data.type === "live-presence") {
          setLiveCount(data.liveCount);
        }
        if (
          data.type === "room-authenticated"
          || data.type === "admin-authenticated"
          || data.type === "room-access-opened"
        ) {
          setRoomAuthenticated(true);
          notifySynchronized();
        }
        if (
          data.type === "room-auth-failed"
          || data.type === "room-access-revoked"
        ) {
          setRoomAuthenticated(false);
        }
        handlersRef.current.forEach((handler) => handler(data));
      } catch {
        // Ignore malformed
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      if (!mountedRef.current) return;
      setSocketConnected(false);
      setRoomAuthenticated(false);
      const intentionalClose = intentionalCloseRef.current;
      intentionalCloseRef.current = false;
      if (intentionalClose || sleepingRef.current) {
        clearReconnectNotice();
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        clearReconnectNotice();
        return;
      }
      scheduleReconnectNotice();
      if (channelId && !reconnectTraceIdRef.current) {
        reconnectTraceIdRef.current = startChatPerformanceCycle(channelId, "reconnect");
      }
      if (channelId && reconnectTraceIdRef.current) {
        incrementChatReconnectAttempt(channelId, reconnectTraceIdRef.current);
      }
      const delay = reconnectDelay(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      reconnectTimeout.current = setTimeout(() => connectRef.current(), delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [channelId, uid, clearReconnectNotice, clearReconnectTimeout, requestSocketAuthorization, scheduleReconnectNotice]);

  useEffect(() => {
    connectRef.current = connect;
    mountedRef.current = true;
    hasSynchronizedRef.current = false;
    const initialConnectTimer = setTimeout(() => connectRef.current(), 0);
    const initialNoticeResetTimer = setTimeout(() => clearReconnectNotice(), 0);
    return () => {
      clearTimeout(initialConnectTimer);
      clearTimeout(initialNoticeResetTimer);
      if (reconnectNoticeTimeout.current) {
        clearTimeout(reconnectNoticeTimeout.current);
        reconnectNoticeTimeout.current = null;
      }
      mountedRef.current = false;
      reconnectTraceIdRef.current = null;
      clearReconnectTimeout();
      clearSleepTimeout();
      sleepingRef.current = false;
      closeSocket("cleanup");
    };
  }, [connect, clearReconnectNotice, clearReconnectTimeout, clearSleepTimeout, closeSocket]);

  useEffect(() => {
    if (!channelId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearReconnectNotice();
        clearReconnectTimeout();
        clearSleepTimeout();
        const socket = wsRef.current;
        if (!socket || (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING)) {
          return;
        }
        sleepTimeout.current = setTimeout(() => {
          if (document.visibilityState !== "hidden") return;
          closeSocket("sleep");
        }, HIDDEN_SOCKET_SLEEP_MS);
        return;
      }

      clearSleepTimeout();
      if (sleepingRef.current) {
        sleepingRef.current = false;
        reconnectAttemptRef.current = 0;
      }
      const socket = wsRef.current;
      if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        connect();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearSleepTimeout();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [channelId, connect, clearReconnectNotice, clearReconnectTimeout, clearSleepTimeout, closeSocket]);

  useEffect(() => {
    if (!channelId) return;
    const handleRoomTokenChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId: string; hasAccess?: boolean }>).detail;
      if (detail.channelId !== channelId) return;
      if (detail.hasAccess === false) {
        setRoomAuthenticated(false);
        return;
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        void requestSocketAuthorization(wsRef.current);
      }
    };
    window.addEventListener("room-token-changed", handleRoomTokenChanged);
    return () => window.removeEventListener("room-token-changed", handleRoomTokenChanged);
  }, [channelId, requestSocketAuthorization]);

  const subscribe = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const connected = socketConnected && roomAuthenticated;
  return { connected, showReconnectNotice, socketConnected, roomAuthenticated, liveCount, subscribe, send };
}
