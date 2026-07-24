"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { getWebSocketUrl } from "@/lib/api";

type MessageHandler = (event: { type: string; [key: string]: unknown }) => void;

export function useRealtime(channelId: string | null, uid: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState(0);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!channelId) return;

    const url = getWebSocketUrl(channelId, uid);
    if (!url) {
      // Mock mode — no WebSocket
      setConnected(true);
      setPresence(3);
      return;
    }

    const ws = new WebSocket(url);
    let pingInterval: ReturnType<typeof setInterval> | null = null;

    ws.onopen = () => {
      setConnected(true);
      // Notify handlers that connection restored (trigger refetch)
      handlersRef.current.forEach((handler) => handler({ type: "reconnected" }));
      // Keep-alive ping every 30 seconds
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30000);
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "presence") {
          setPresence(data.count);
        }
        if (data.type === "pong" || data.type === "ping") return; // ignore keep-alive
        handlersRef.current.forEach((handler) => handler(data));
      } catch {
        // Ignore malformed
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (pingInterval) clearInterval(pingInterval);
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

  return { connected, presence, subscribe, send };
}
