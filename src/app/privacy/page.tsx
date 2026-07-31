import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata: Metadata = {
  title: "개인정보처리방침 / Privacy Policy · yap.",
};

export default function PrivacyPage() {
  return <LegalDocumentPage document="privacy" />;
}
