"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { ko, en, type LocaleKeys } from "@/lib/locales";

type Locale = "ko" | "en";
type LocaleMap = Record<LocaleKeys, string>;

const locales: Record<Locale, LocaleMap> = { ko, en };

interface LocaleContextValue {
  locale: Locale;
  timeZone: string;
  setLocale: (locale: Locale) => void;
  t: (key: LocaleKeys) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "ko",
  timeZone: "UTC",
  setLocale: () => {},
  t: (key) => ko[key],
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Keep the server render and the browser's first render identical. Reading
  // localStorage in the state initializer makes saved English preferences
  // hydrate over Korean server HTML and causes React to discard the tree.
  const [locale, setLocaleState] = useState<Locale>("ko");
  const [timeZone, setTimeZone] = useState("UTC");

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem("locale", newLocale);
    } catch {}
    window.dispatchEvent(new CustomEvent("locale-changed", {
      detail: { locale: newLocale },
    }));
  }, []);

  const t = useCallback((key: LocaleKeys): string => {
    return locales[locale][key] || locales.ko[key] || key;
  }, [locale]);

  // Restore the saved preference only after hydration. New visitors use their
  // browser language without changing the initial server/client markup.
  useEffect(() => {
    let savedLocale: string | null = null;
    try {
      savedLocale = localStorage.getItem("locale");
    } catch {}
    const nextLocale: Locale = savedLocale === "ko" || savedLocale === "en"
      ? savedLocale
      : navigator.language.toLowerCase().startsWith("ko")
        ? "ko"
        : "en";
    setLocaleState(nextLocale);
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const handleLocaleChanged = (event: Event) => {
      const nextLocale = (event as CustomEvent<{ locale?: string }>).detail?.locale;
      if (nextLocale === "ko" || nextLocale === "en") {
        setLocaleState(nextLocale);
      }
    };
    window.addEventListener("locale-changed", handleLocaleChanged);
    return () => window.removeEventListener("locale-changed", handleLocaleChanged);
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, timeZone, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
