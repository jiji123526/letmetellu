import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { getRequestLocale } from "@/lib/server-locale";

export const metadata: Metadata = {
  title: "개인정보처리방침 / Privacy Policy · yap.",
};

export default async function PrivacyPage() {
  const locale = await getRequestLocale();
  return <LegalDocumentPage document="privacy" locale={locale} />;
}
