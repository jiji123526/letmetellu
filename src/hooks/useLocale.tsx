"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { ko, en, type LocaleKeys } from "@/lib/locales";

type Locale = "ko" | "en";
type LocaleMap = Record<LocaleKeys, string>;

const locales: Record<Locale, LocaleMap> = { ko, en };

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: LocaleKeys) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "ko",
  setLocale: () => {},
  t: (key) => ko[key],
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return "ko";
    return (localStorage.getItem("locale") as Locale) || "ko";
  });

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("locale", newLocale);
  }, []);

  const t = useCallback((key: LocaleKeys): string => {
    return locales[locale][key] || locales.ko[key] || key;
  }, [locale]);

  // Auto-detect on first visit (no saved preference)
  useEffect(() => {
    if (!localStorage.getItem("locale")) {
      const browserLang = navigator.language.slice(0, 2);
      if (browserLang !== "ko") {
        setLocale("en");
      }
    }
  }, [setLocale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
