import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata: Metadata = {
  title: "Terms of Service · yap.",
};

export default function TermsPage() {
  return <LegalDocumentPage document="terms" />;
}
