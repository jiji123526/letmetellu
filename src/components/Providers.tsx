"use client";

import { SessionProvider } from "next-auth/react";
import { GlobalNoticeGate } from "@/components/GlobalNoticeGate";
import { LocaleProvider } from "@/hooks/useLocale";
import { UserPreferencesSync } from "@/components/UserPreferencesSync";

export function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <UserPreferencesSync />

      <LocaleProvider>
        <GlobalNoticeGate />
        {children}
      </LocaleProvider>
    </SessionProvider>
  );
}
