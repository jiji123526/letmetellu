"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { getRoomToken, getWebSocketUrl } from "@/lib/api";

type MessageHandler = (event: { type: string; [key: string]: unknown }) => void;

const RECONNECT_DELAY_MS = 2000;
const HIDDEN_SOCKET_SLEEP_MS = 90 * 1000;

export function useRealtime(channelId: string | null, uid: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const [socketConnected, setSocketConnected] = useState(false);
  const [roomAuthenticated, setRoomAuthenticated] = useState(false);
  const [presence, setPresence] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRoomAuthRequest = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const sleepingRef = useRef(false);

  const clearReconnectTimeout = useCallback(() => {
    if (!reconnectTimeout.current) return;
    clearTimeout(reconnectTimeout.current);
    reconnectTimeout.current = null;
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
    if (typeof document !== "undefined" && document.visibilityState !== "visible" && sleepingRef.current) {
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
      setPresence(3);
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
      handlersRef.current.forEach((handler) => handler({ type: "reconnected" }));
    };

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setSocketConnected(true);
      setRoomAuthenticated(false);
      handlersRef.current.forEach((handler) => handler({ type: "socket-opened" }));
      const roomToken = getRoomToken(channelId);
      const requestId = crypto.randomUUID();
      latestRoomAuthRequest.current = requestId;
      ws.send(JSON.stringify({ type: "auth-room", token: roomToken, requestId }));
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
        if (data.type === "presence") {
          setPresence(data.count);
          if (data.liveCount !== undefined) setLiveCount(data.liveCount);
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
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      reconnectTimeout.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [channelId, uid, clearReconnectTimeout]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearReconnectTimeout();
      clearSleepTimeout();
      sleepingRef.current = false;
      closeSocket("cleanup");
    };
  }, [connect, clearReconnectTimeout, clearSleepTimeout, closeSocket]);

  useEffect(() => {
    if (!channelId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
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
  }, [channelId, connect, clearReconnectTimeout, clearSleepTimeout, closeSocket]);

  useEffect(() => {
    if (!channelId) return;
    const handleRoomTokenChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId: string; token: string | null }>).detail;
      if (detail.channelId !== channelId) return;
      if (!detail.token) {
        setRoomAuthenticated(false);
        return;
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const requestId = crypto.randomUUID();
        latestRoomAuthRequest.current = requestId;
        wsRef.current.send(JSON.stringify({ type: "auth-room", token: detail.token, requestId }));
      }
    };
    window.addEventListener("room-token-changed", handleRoomTokenChanged);
    return () => window.removeEventListener("room-token-changed", handleRoomTokenChanged);
  }, [channelId]);

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
  return { connected, socketConnected, roomAuthenticated, presence, liveCount, subscribe, send };
}
