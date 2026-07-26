"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

const DEFAULT_FONT_SIZE = 17;

function normalizeFontSize(value: unknown) {
  const size = Number(value);
  return Number.isInteger(size) && size >= 12 && size <= 20 ? size : DEFAULT_FONT_SIZE;
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
      .then(async (data: { font_size?: number | null } | null) => {
        if (!data) return;
        if (data.font_size) {
          applyFontSize(data.font_size);
          return;
        }
        const existingLocalSize = localStorage.getItem("fontSize");
        const size = applyFontSize(existingLocalSize || DEFAULT_FONT_SIZE);
        await fetch("/api/user", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ font_size: size }),
          signal: controller.signal,
        });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [status, session?.user?.id]);

  return null;
}
