import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata: Metadata = {
  title: "서비스 이용약관 / Terms of Service · yap.",
};

export default function TermsPage() {
  return <LegalDocumentPage document="terms" />;
}
