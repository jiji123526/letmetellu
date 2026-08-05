"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "@/hooks/useLocale";
import {
  fetchVisitSurveyStatus,
  submitVisitSurveyResponse,
  type VisitSurveyOutcome,
  type VisitSurveySourcePage,
} from "@/lib/api-survey";

const VISIT_COUNT_KEY = "yap_visit_survey_count_v1";
const SESSION_COUNTED_KEY = "yap_visit_survey_session_counted_v1";
const TERMINAL_KEY = "yap_visit_survey_terminal_v1";
const SURVEY_VISIT_THRESHOLD = 10;
const SURVEY_PROMPT_DELAY_MS = 1_500;
const SURVEY_DESCRIPTION_MAX_LENGTH = 1_500;

function readVisitCount(): number {
  try {
    const count = Number.parseInt(localStorage.getItem(VISIT_COUNT_KEY) || "0", 10);
    return Number.isFinite(count) ? Math.max(0, count) : 0;
  } catch {
    return 0;
  }
}

function markTerminal(): void {
  try {
    localStorage.setItem(TERMINAL_KEY, "1");
  } catch {}
}

function hasTerminalState(): boolean {
  try {
    return localStorage.getItem(TERMINAL_KEY) === "1";
  } catch {
    return false;
  }
}

function getSurveySource(pathname: string): VisitSurveySourcePage | null {
  if (pathname === "/dashboard") return "dashboard";
  if (pathname.startsWith("/ch/")) return "channel";
  return null;
}

export function VisitSurvey() {
  const pathname = usePathname();
  const { locale, t } = useLocale();
  const [sourcePage, setSourcePage] = useState<VisitSurveySourcePage | null>(null);
  const [visitCount, setVisitCount] = useState(SURVEY_VISIT_THRESHOLD);
  const [step, setStep] = useState<"question" | "description">("question");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const attemptedRef = useRef(false);
  const countedThisMountRef = useRef(false);

  useEffect(() => {
    const source = getSurveySource(pathname);
    if (!source || hasTerminalState() || attemptedRef.current) return;

    let count = readVisitCount();
    if (!countedThisMountRef.current) {
      countedThisMountRef.current = true;
      let shouldCount = true;
      try {
        shouldCount = sessionStorage.getItem(SESSION_COUNTED_KEY) !== "1";
        if (shouldCount) {
          sessionStorage.setItem(SESSION_COUNTED_KEY, "1");
        }
      } catch {}
      if (shouldCount) {
        count += 1;
        try {
          localStorage.setItem(VISIT_COUNT_KEY, String(count));
        } catch {}
      }
    }
    if (count < SURVEY_VISIT_THRESHOLD) return;

    const timer = window.setTimeout(() => {
      attemptedRef.current = true;
      void fetchVisitSurveyStatus()
        .then((status) => {
          if (status.responded) {
            markTerminal();
            return;
          }
          setVisitCount(count);
          setSourcePage(source);
        })
        .catch(() => {});
    }, SURVEY_PROMPT_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [pathname]);

  const dismiss = useCallback((outcome: Exclude<VisitSurveyOutcome, "feedback">) => {
    if (!sourcePage) return;
    markTerminal();
    setSourcePage(null);
    void submitVisitSurveyResponse({
      outcome,
      sourcePage,
      locale,
      visitCount,
      keepalive: true,
    }).catch(() => {});
  }, [locale, sourcePage, visitCount]);

  useEffect(() => {
    if (!sourcePage) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        dismiss("dismissed");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dismiss, sourcePage, submitting]);

  const submitDescription = async () => {
    if (!sourcePage) return;
    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setError(t("visitSurveyDescriptionRequired"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await submitVisitSurveyResponse({
        outcome: "feedback",
        description: trimmedDescription,
        sourcePage,
        locale,
        visitCount,
      });
      markTerminal();
      setSourcePage(null);
    } catch {
      setError(t("visitSurveySubmitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!sourcePage) return null;

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center px-5"
      style={{ background: "rgba(15, 23, 42, .44)", backdropFilter: "blur(4px)" }}
      onClick={(event) => {
        if (!submitting && event.target === event.currentTarget) dismiss("dismissed");
      }}
      role="presentation"
    >
      <section
        className="w-full max-w-[380px] overflow-hidden"
        style={{
          borderRadius: "24px",
          background: "var(--bg, #fff)",
          color: "var(--gray-text, #111)",
          boxShadow: "0 24px 70px rgba(15, 23, 42, .28)",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="visit-survey-title"
      >
        <div className="px-6 pt-7 pb-5">
          <div
            className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: "#fff3d8", color: "#b45309", transform: "rotate(-3deg)" }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.5A2.5 2.5 0 0 1 4 13.5z" />
              <path d="M8 8h8M8 11.5h5" />
            </svg>
          </div>

          <div className="mb-2 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "#b45309" }}>
            {t("visitSurveyEyebrow")}
          </div>
          <h2 id="visit-survey-title" className="m-0 text-[22px] font-bold tracking-[-.025em]">
            {step === "question" ? t("visitSurveyQuestion") : t("visitSurveyDescriptionTitle")}
          </h2>
          <p className="mt-2 mb-0 text-[14px] leading-[1.55]" style={{ color: "var(--meta, #8e8e93)" }}>
            {step === "question" ? t("visitSurveyQuestionDetail") : t("visitSurveyDescriptionDetail")}
          </p>

          {step === "description" && (
            <>
              <textarea
                autoFocus
                value={description}
                maxLength={SURVEY_DESCRIPTION_MAX_LENGTH}
                disabled={submitting}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setError("");
                }}
                placeholder={t("visitSurveyDescriptionPlaceholder")}
                className="mt-5 min-h-[130px] w-full resize-y rounded-2xl p-4 text-[14px] leading-[1.5] outline-none"
                style={{
                  border: `1px solid ${error ? "#dc2626" : "var(--hairline, #d1d1d6)"}`,
                  background: "var(--card, #f2f2f7)",
                  color: "var(--gray-text, #111)",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                }}
              />
              <div className="mt-2 flex items-center justify-between text-[12px]">
                <span style={{ color: "#dc2626" }}>{error}</span>
                <span style={{ color: "var(--meta, #8e8e93)" }}>{description.length}/{SURVEY_DESCRIPTION_MAX_LENGTH}</span>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 border-t px-5 py-4" style={{ borderColor: "var(--hairline, #d1d1d6)" }}>
          {step === "question" ? (
            <>
              <button type="button" className="flex-1 rounded-xl border-0 px-4 py-3 text-[14px] font-semibold cursor-pointer" style={{ background: "var(--card, #f2f2f7)", color: "var(--secondary-text, #3c3c43)", fontFamily: "inherit" }} onClick={() => dismiss("no_issues")}>
                {t("visitSurveyNo")}
              </button>
              <button type="button" className="flex-1 rounded-xl border-0 px-4 py-3 text-[14px] font-semibold text-white cursor-pointer" style={{ background: "#b45309", fontFamily: "inherit" }} onClick={() => setStep("description")}>
                {t("visitSurveyYes")}
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={submitting} className="flex-1 rounded-xl border-0 px-4 py-3 text-[14px] font-semibold cursor-pointer disabled:opacity-60" style={{ background: "var(--card, #f2f2f7)", color: "var(--secondary-text, #3c3c43)", fontFamily: "inherit" }} onClick={() => dismiss("dismissed")}>
                {t("cancel")}
              </button>
              <button type="button" disabled={submitting} className="flex-1 rounded-xl border-0 px-4 py-3 text-[14px] font-semibold text-white cursor-pointer disabled:opacity-60" style={{ background: "#b45309", fontFamily: "inherit" }} onClick={() => void submitDescription()}>
                {submitting ? t("loading") : t("visitSurveySubmit")}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
