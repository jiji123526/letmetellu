"use client";

import { SessionProvider } from "next-auth/react";
import { LocaleProvider } from "@/hooks/useLocale";
import { UserPreferencesSync } from "@/components/UserPreferencesSync";
import { ProductUpdateDialog } from "@/components/ProductUpdateDialog";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <UserPreferencesSync />
      <LocaleProvider>
        <ProductUpdateDialog />
        {children}
      </LocaleProvider>
    </SessionProvider>
  );
}
