"use client";

import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";
import { legalDocuments } from "./legalDocuments";

const copy = {
  ko: {
    back: "대시보드로 돌아가기",
    privacyTitle: "개인정보처리방침",
    termsTitle: "서비스 이용약관",
  },
  en: {
    back: "Back to dashboard",
    privacyTitle: "Privacy Policy",
    termsTitle: "Terms of Service",
  },
} as const;

interface LegalDocumentPageProps {
  document: "privacy" | "terms";
}

export function LegalDocumentPage({ document }: LegalDocumentPageProps) {
  const { locale } = useLocale();
  const text = copy[locale];
  const content = legalDocuments[document][locale];
  const title = document === "privacy" ? text.privacyTitle : text.termsTitle;

  return (
    <main className="min-h-dvh px-4 py-8" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      <div className="mx-auto w-full max-w-[760px]">
        <Link href="/dashboard" className="inline-flex no-underline text-[14px]" style={{ color: "var(--tint)" }}>
          ← {text.back}
        </Link>

        <section className="mt-4 rounded-[28px] px-6 py-7 md:px-8" style={{ background: "var(--card)", boxShadow: "0 22px 60px rgba(0,0,0,.08)" }}>
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.03em]">{title}</h1>
          <p className="mt-3 mb-0 text-[14px] leading-[1.65]" style={{ color: "var(--secondary-text)" }}>
            {content.intro}
          </p>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {content.versions.map((version) => (
              <section
                key={version.heading}
                className="rounded-[22px] px-5 py-5"
                style={{ background: "var(--bg)", border: "1px dashed var(--hairline)" }}
              >
                <h2 className="m-0 text-[16px] font-semibold">{version.heading}</h2>
                <div className="mt-4 space-y-5 rounded-[16px] px-4 py-4 text-[14px] leading-[1.7]" style={{ background: "var(--card)", color: "var(--secondary-text)" }}>
                  {version.sections.map((section) => (
                    <section key={section.heading}>
                      <h3 className="m-0 text-[14px] font-semibold" style={{ color: "var(--gray-text)" }}>
                        {section.heading}
                      </h3>
                      {section.paragraphs?.map((paragraph) => (
                        <p key={paragraph} className="mt-2 mb-0 whitespace-pre-line">
                          {paragraph}
                        </p>
                      ))}
                      {section.bullets && (
                        <ul className="mt-2 mb-0 pl-5">
                          {section.bullets.map((bullet) => (
                            <li key={bullet} className="mt-1">
                              {bullet}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
