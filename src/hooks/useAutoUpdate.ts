"use client";

import { useEffect, useRef } from "react";

const APP_VERSION = process.env.APP_VERSION || "local";

export function useAutoUpdate(hasDraft: boolean) {
  const pendingVersion = useRef<string | null>(null);

  useEffect(() => {
    if (APP_VERSION === "local") return;

    const checkForUpdate = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const { version } = await res.json();
        if (version && version !== "local" && version !== APP_VERSION) {
          pendingVersion.current = version;
          if (!hasDraft) window.location.reload();
        }
      } catch {}
    };

    // Check every 60 seconds
    const interval = setInterval(checkForUpdate, 60000);
    // Check on tab focus
    const onVisibility = () => { if (document.visibilityState === "visible") checkForUpdate(); };
    document.addEventListener("visibilitychange", onVisibility);
    // Initial check
    checkForUpdate();

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasDraft]);

  // Call this when draft clears (e.g., after send)
  useEffect(() => {
    if (!hasDraft && pendingVersion.current) {
      window.location.reload();
    }
  }, [hasDraft]);
}
