"use client";

import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";

const copy = {
  ko: {
    privacy: "개인정보처리방침",
    terms: "서비스 이용약관",
    support: "이용 문의",
  },
  en: {
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    support: "Support",
  },
} as const;

export function LegalFooter() {
  const { locale } = useLocale();
  const text = copy[locale];

  return (
    <footer className="mt-auto px-5 pt-5 text-center">
      <div className="flex items-center justify-center gap-3 text-[12px]">
        <Link href="/privacy" className="no-underline transition-opacity hover:opacity-100" style={{ color: "var(--meta)", opacity: 0.82 }}>
          {text.privacy}
        </Link>
        <span aria-hidden="true" style={{ color: "var(--meta)", opacity: 0.45 }}>·</span>
        <Link href="/terms" className="no-underline transition-opacity hover:opacity-100" style={{ color: "var(--meta)", opacity: 0.82 }}>
          {text.terms}
        </Link>
        <span aria-hidden="true" style={{ color: "var(--meta)", opacity: 0.45 }}>·</span>
        <Link href="/support" className="no-underline transition-opacity hover:opacity-100" style={{ color: "var(--meta)", opacity: 0.82 }}>
          {text.support}
        </Link>
      </div>
    </footer>
  );
}
