"use client";

import { useEffect, useRef, useState } from "react";

const PUSH_NAVIGATION_TYPE = "push-navigation";
const PUSH_VISIBILITY_PROBE_TYPE = "push-visibility-probe";
const PUSH_FOREGROUND_NOTIFICATION_TYPE = "push-foreground-notification";

interface ForegroundNotification {
  title: string;
  body: string;
  target: string;
}

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
  const [notification, setNotification] = useState<ForegroundNotification | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === PUSH_VISIBILITY_PROBE_TYPE) {
        event.ports[0]?.postMessage({
          visible: document.visibilityState === "visible",
          target: `${window.location.pathname}${window.location.search}`,
        });
        return;
      }

      if (event.data?.type === PUSH_FOREGROUND_NOTIFICATION_TYPE) {
        const target = readSafeChannelTarget(event.data?.notification?.target);
        if (!target || document.visibilityState !== "visible") return;

        const title = typeof event.data?.notification?.title === "string"
          ? event.data.notification.title
          : "yap.";
        const body = typeof event.data?.notification?.body === "string"
          ? event.data.notification.body
          : "";
        setNotification({ title, body, target });
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(() => setNotification(null), 6000);
        return;
      }

      if (event.data?.type !== PUSH_NAVIGATION_TYPE) return;
      const target = readSafeChannelTarget(event.data?.target);
      if (!target) return;

      const current = `${window.location.pathname}${window.location.search}`;
      if (current !== target) window.location.assign(target);
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  if (!notification) return null;

  return (
    <button
      type="button"
      className="fixed left-1/2 z-[700] w-[calc(100%-24px)] max-w-[430px] -translate-x-1/2 rounded-[18px] border border-black/10 bg-white/92 px-4 py-3 text-left text-black shadow-[0_10px_35px_rgba(0,0,0,0.22)] backdrop-blur-xl dark:border-white/15 dark:bg-[#242428]/92 dark:text-white"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 10px)" }}
      onClick={() => window.location.assign(notification.target)}
      aria-label={`${notification.title}${notification.body ? ` ${notification.body}` : ""}`}
    >
      <span className="block truncate text-[15px] font-semibold leading-5">
        {notification.title}
      </span>
      {notification.body && (
        <span className="mt-0.5 block truncate text-[14px] leading-5 text-black/65 dark:text-white/70">
          {notification.body}
        </span>
      )}
    </button>
  );
}
