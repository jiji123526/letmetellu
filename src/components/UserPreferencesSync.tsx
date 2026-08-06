"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

const DEFAULT_FONT_SIZE = 15;
const DEFAULT_LOCALE = "ko";

function normalizeLocale(value: unknown): "ko" | "en" {
  return value === "en" ? "en" : "ko";
}

function normalizeFontSize(value: unknown) {
  const size = Number(value);
  return Number.isInteger(size) && size >= 12 && size <= 20 ? size : DEFAULT_FONT_SIZE;
}

function persistLocaleCookie(locale: "ko" | "en") {
  document.cookie = `locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function applyFontSize(value: unknown) {
  const size = normalizeFontSize(value);
  document.documentElement.style.setProperty("--bubble-font-size", `${size}px`);
  window.dispatchEvent(new CustomEvent("font-size-changed", { detail: { size } }));
  return size;
}

export async function saveFontSize(value: number, loggedIn: boolean) {
  const size = applyFontSize(value);
  if (!loggedIn) {
    localStorage.setItem("fontSize", String(size));
    return;
  }
  await fetch("/api/user", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ font_size: size }),
  });
}

export function UserPreferencesSync() {
  const { data: session, status } = useSession();
  const persistedLocaleRef = useRef<"ko" | "en" | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = (dark: boolean) => {
      document.documentElement.classList.toggle("dark", dark);
    };
    const handleChange = (event: MediaQueryListEvent) => applyTheme(event.matches);
    applyTheme(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      applyFontSize(localStorage.getItem("fontSize") || DEFAULT_FONT_SIZE);
      return;
    }

    const controller = new AbortController();
    fetch("/api/user", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then(async (data: { font_size?: number | null; locale?: string | null } | null) => {
        if (!data) return;
        const browserLocale = navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
        const localLocale = normalizeLocale(localStorage.getItem("locale") || browserLocale || DEFAULT_LOCALE);
        const syncedLocale = data.locale === "ko" || data.locale === "en" ? data.locale : null;
        const nextLocale = syncedLocale || localLocale;
        persistedLocaleRef.current = syncedLocale;
        localStorage.setItem("locale", nextLocale);
        persistLocaleCookie(nextLocale);
        window.dispatchEvent(new CustomEvent("locale-changed", {
          detail: { locale: nextLocale },
        }));

        if (data.font_size) {
          applyFontSize(data.font_size);
        } else {
          const existingLocalSize = localStorage.getItem("fontSize");
          const size = applyFontSize(existingLocalSize || DEFAULT_FONT_SIZE);
          await fetch("/api/user", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ font_size: size }),
            signal: controller.signal,
          });
        }
        if (!syncedLocale) {
          await fetch("/api/user", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locale: nextLocale }),
            signal: controller.signal,
          });
          persistedLocaleRef.current = nextLocale;
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [status, session?.user?.id]);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.id) return;
    const controller = new AbortController();
    const handleLocaleChanged = (event: Event) => {
      const nextLocale = (event as CustomEvent<{ locale?: string }>).detail?.locale;
      if (nextLocale !== "ko" && nextLocale !== "en") return;
      if (persistedLocaleRef.current === nextLocale) return;
      persistedLocaleRef.current = nextLocale;
      persistLocaleCookie(nextLocale);
      fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
        signal: controller.signal,
        keepalive: true,
      }).catch(() => {
        persistedLocaleRef.current = null;
      });
    };

    window.addEventListener("locale-changed", handleLocaleChanged);
    return () => {
      controller.abort();
      window.removeEventListener("locale-changed", handleLocaleChanged);
    };
  }, [status, session?.user?.id]);

  return null;
}
