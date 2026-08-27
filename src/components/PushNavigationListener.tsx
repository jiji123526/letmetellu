"use client";

import { useEffect } from "react";

const PUSH_NAVIGATION_TYPE = "push-navigation";

function readSafeChannelTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;

  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin || !target.pathname.startsWith("/ch/")) {
      return null;
    }
    return `${target.pathname}${target.search}`;
  } catch {
    return null;
  }
}

export default function PushNavigationListener() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== PUSH_NAVIGATION_TYPE) return;
      const target = readSafeChannelTarget(event.data?.target);
      if (!target) return;

      const current = `${window.location.pathname}${window.location.search}`;
      if (current !== target) window.location.assign(target);
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, []);

  return null;
}
