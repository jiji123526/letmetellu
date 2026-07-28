"use client";

import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";

const copy = {
  ko: {
    back: "대시보드로 돌아가기",
    privacyTitle: "개인정보처리방침",
    privacyIntro: "최종 개인정보처리방침 문구를 넣을 자리입니다.",
    termsTitle: "서비스 이용약관",
    termsIntro: "최종 서비스 이용약관 문구를 넣을 자리입니다.",
    koreanVersion: "한국어 버전",
    englishVersion: "English Version",
    placeholder: "나중에 전달할 정확한 내용을 여기에 넣으면 됩니다.",
  },
  en: {
    back: "Back to dashboard",
    privacyTitle: "Privacy Policy",
    privacyIntro: "This is a placeholder for the final privacy policy content.",
    termsTitle: "Terms of Service",
    termsIntro: "This is a placeholder for the final terms of service content.",
    koreanVersion: "한국어 버전",
    englishVersion: "English Version",
    placeholder: "Drop the final approved content here later.",
  },
} as const;

interface LegalDocumentPageProps {
  document: "privacy" | "terms";
}

export function LegalDocumentPage({ document }: LegalDocumentPageProps) {
  const { locale } = useLocale();
  const text = copy[locale];
  const title = document === "privacy" ? text.privacyTitle : text.termsTitle;
  const intro = document === "privacy" ? text.privacyIntro : text.termsIntro;

  return (
    <main className="min-h-dvh px-4 py-8" style={{ background: "var(--bg)", color: "var(--gray-text)" }}>
      <div className="mx-auto w-full max-w-[760px]">
        <Link href="/dashboard" className="inline-flex no-underline text-[14px]" style={{ color: "var(--tint)" }}>
          ← {text.back}
        </Link>

        <section className="mt-4 rounded-[28px] px-6 py-7 md:px-8" style={{ background: "var(--card)", boxShadow: "0 22px 60px rgba(0,0,0,.08)" }}>
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.03em]">{title}</h1>
          <p className="mt-3 mb-0 text-[14px] leading-[1.65]" style={{ color: "var(--secondary-text)" }}>
            {intro}
          </p>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {[
              { heading: text.koreanVersion, body: text.placeholder },
              { heading: text.englishVersion, body: text.placeholder },
            ].map((section) => (
              <section
                key={section.heading}
                className="rounded-[22px] px-5 py-5"
                style={{ background: "var(--bg)", border: "1px dashed var(--hairline)" }}
              >
                <h2 className="m-0 text-[16px] font-semibold">{section.heading}</h2>
                <div className="mt-4 min-h-[220px] rounded-[16px] px-4 py-4 text-[14px] leading-[1.7]" style={{ background: "var(--card)", color: "var(--secondary-text)" }}>
                  {section.body}
                </div>
              </section>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
