"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { getRoomToken, getWebSocketUrl } from "@/lib/api";

type MessageHandler = (event: { type: string; [key: string]: unknown }) => void;

export function useRealtime(channelId: string | null, uid: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const [socketConnected, setSocketConnected] = useState(false);
  const [roomAuthenticated, setRoomAuthenticated] = useState(false);
  const [presence, setPresence] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRoomAuthRequest = useRef<string | null>(null);

  const connect = useCallback(() => {
    if (!channelId) return;

    const url = getWebSocketUrl(channelId, uid);
    if (!url) {
      // Mock mode — no WebSocket
      setSocketConnected(true);
      setRoomAuthenticated(true);
      setPresence(3);
      return;
    }

    const ws = new WebSocket(url);
    let synchronized = false;

    const notifySynchronized = () => {
      if (synchronized) return;
      synchronized = true;
      handlersRef.current.forEach((handler) => handler({ type: "reconnected" }));
    };

    ws.onopen = () => {
      setSocketConnected(true);
      setRoomAuthenticated(false);
      const roomToken = getRoomToken(channelId);
      const requestId = crypto.randomUUID();
      latestRoomAuthRequest.current = requestId;
      ws.send(JSON.stringify({ type: "auth-room", token: roomToken, requestId }));
    };

    ws.onmessage = (e) => {
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
      setSocketConnected(false);
      setRoomAuthenticated(false);
      // Reconnect after 2s
      reconnectTimeout.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [channelId, uid]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeout.current ?? undefined);
      wsRef.current?.close();
    };
  }, [connect]);

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
