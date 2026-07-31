"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { legalDocuments } from "./legalDocuments";

const copy = {
  ko: {
    back: "대시보드로 돌아가기",
    privacyTitle: "개인정보처리방침",
    termsTitle: "서비스 이용약관",
    effectiveDate: "시행일",
    lastUpdated: "최종 업데이트",
  },
  en: {
    back: "Back to dashboard",
    privacyTitle: "Privacy Policy",
    termsTitle: "Terms of Service",
    effectiveDate: "Effective date",
    lastUpdated: "Last updated",
  },
} as const;

interface LegalDocumentPageProps {
  document: "privacy" | "terms";
}

export function LegalDocumentPage({ document }: LegalDocumentPageProps) {
  const { locale } = useLocale();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated) {
    return (
      <main className="min-h-dvh px-4 py-8" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
        <div className="mx-auto w-full max-w-[820px]">
          <section
            className="rounded-[28px] px-6 py-7 md:px-8"
            style={{ background: "var(--card)", boxShadow: "0 22px 60px rgba(0,0,0,.08)" }}
          >
            <div className="h-4 w-28 animate-pulse rounded-full" style={{ background: "var(--hairline)" }} />
            <div className="mt-5 h-8 w-52 animate-pulse rounded-full" style={{ background: "var(--hairline)" }} />
            <div className="mt-4 h-4 w-full animate-pulse rounded-full" style={{ background: "var(--hairline)" }} />
            <div className="mt-2 h-4 w-[82%] animate-pulse rounded-full" style={{ background: "var(--hairline)" }} />
            <div className="mt-8 h-[420px] animate-pulse rounded-[24px]" style={{ background: "var(--bg)" }} />
          </section>
        </div>
      </main>
    );
  }

  const text = copy[locale];
  const content = legalDocuments[document][locale];
  const title = document === "privacy" ? text.privacyTitle : text.termsTitle;

  return (
    <main className="min-h-dvh px-4 py-8" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      <div className="mx-auto w-full max-w-[820px]">
        <Link href="/dashboard" className="inline-flex no-underline text-[14px]" style={{ color: "var(--tint)" }}>
          ← {text.back}
        </Link>

        <article
          className="mt-4 rounded-[28px] px-6 py-7 md:px-8"
          style={{ background: "var(--card)", boxShadow: "0 22px 60px rgba(0,0,0,.08)" }}
        >
          <h1 className="m-0 text-[30px] font-semibold tracking-[-0.03em]">{title}</h1>
          <p className="mt-3 mb-0 text-[14px] leading-[1.65]" style={{ color: "var(--secondary-text)" }}>
            {content.intro}
          </p>

          <div
            className="mt-6 grid gap-3 rounded-[22px] px-4 py-4 text-[13px] md:grid-cols-2 md:px-5"
            style={{ background: "var(--bg)", border: "1px solid var(--hairline)", color: "var(--secondary-text)" }}
          >
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--meta)" }}>
                {text.effectiveDate}
              </div>
              <div className="mt-1 text-[14px] font-medium" style={{ color: "var(--gray-text)" }}>
                {content.effectiveDate}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--meta)" }}>
                {text.lastUpdated}
              </div>
              <div className="mt-1 text-[14px] font-medium" style={{ color: "var(--gray-text)" }}>
                {content.lastUpdated}
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-[24px]" style={{ border: "1px solid var(--hairline)", overflow: "hidden" }}>
            {content.sections.map((section, index) => (
              <section
                key={section.heading}
                className="px-5 py-5 md:px-6"
                style={{
                  background: index % 2 === 0 ? "var(--card)" : "var(--bg)",
                  borderTop: index === 0 ? "none" : "1px solid var(--hairline)",
                }}
              >
                <h2 className="m-0 text-[15px] font-semibold leading-[1.5]" style={{ color: "var(--gray-text)" }}>
                  {section.heading}
                </h2>
                {section.paragraphs?.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="mt-3 mb-0 whitespace-pre-line text-[14px] leading-[1.78]"
                    style={{ color: "var(--secondary-text)" }}
                  >
                    {paragraph}
                  </p>
                ))}
                {section.bullets && (
                  <ul className="mt-3 mb-0 list-disc pl-5 text-[14px] leading-[1.78]" style={{ color: "var(--secondary-text)" }}>
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="mt-1.5">
                        {bullet}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}
