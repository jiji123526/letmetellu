import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { getRequestLocale } from "@/lib/server-locale";

export const metadata: Metadata = {
  title: "서비스 이용약관 / Terms of Service · yap.",
};

export default async function TermsPage() {
  const locale = await getRequestLocale();
  return <LegalDocumentPage document="terms" locale={locale} />;
}
