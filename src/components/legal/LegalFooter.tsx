"use client";

import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";

const copy = {
  ko: {
    heading: "정책 및 약관",
    privacy: "개인정보처리방침",
    terms: "서비스 이용약관",
  },
  en: {
    heading: "Policies & Terms",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
  },
} as const;

export function LegalFooter() {
  const { locale } = useLocale();
  const text = copy[locale];

  return (
    <footer className="px-5 pt-6 pb-10 text-center" style={{ borderTop: "1px solid var(--hairline)" }}>
      <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--meta)" }}>
        {text.heading}
      </div>
      <div className="mt-3 flex items-center justify-center gap-3 text-[13px]">
        <Link href="/privacy" className="no-underline" style={{ color: "var(--tint)" }}>
          {text.privacy}
        </Link>
        <span aria-hidden="true" style={{ color: "var(--hairline)" }}>•</span>
        <Link href="/terms" className="no-underline" style={{ color: "var(--tint)" }}>
          {text.terms}
        </Link>
      </div>
    </footer>
  );
}
