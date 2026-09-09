"use client";

import { SessionProvider } from "next-auth/react";
import { GlobalNoticeGate } from "@/components/GlobalNoticeGate";
import { LocaleProvider } from "@/hooks/useLocale";
import { UserPreferencesSync } from "@/components/UserPreferencesSync";

export function RootProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <LocaleProvider>
        <GlobalNoticeGate />
        {children}
      </LocaleProvider>
    </SessionProvider>
  );
}

export function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <UserPreferencesSync />
      {children}
    </>
  );
}
