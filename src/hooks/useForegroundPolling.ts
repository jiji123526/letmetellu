"use client";

import { useEffect } from "react";

export function useForegroundPolling({
  enabled,
  pollMs,
  runImmediately = false,
  onRefresh,
}: {
  enabled: boolean;
  pollMs: number;
  runImmediately?: boolean;
  onRefresh: () => void;
}) {
  useEffect(() => {
    if (!enabled) return;

    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      onRefresh();
    };

    const initialTimer = runImmediately ? window.setTimeout(refresh, 0) : null;
    const timer = window.setInterval(refresh, pollMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      if (initialTimer !== null) window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, onRefresh, pollMs, runImmediately]);
}
