import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata: Metadata = {
  title: "Privacy Policy · yap.",
};

export default function PrivacyPage() {
  return <LegalDocumentPage document="privacy" />;
}
