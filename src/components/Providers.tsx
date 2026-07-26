"use client";

import { SessionProvider } from "next-auth/react";
import { LocaleProvider } from "@/hooks/useLocale";
import { UserPreferencesSync } from "@/components/UserPreferencesSync";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <UserPreferencesSync />
      <LocaleProvider>{children}</LocaleProvider>
    </SessionProvider>
  );
}
