const SURVEY_DESCRIPTION_MAX_LENGTH = 1_500;

type SurveyOutcome = "no_issues" | "feedback" | "dismissed";
type SurveySourcePage = "dashboard" | "channel";
type SurveyLocale = "ko" | "en";

export interface SurveySubmission {
  outcome: SurveyOutcome;
  description: string | null;
  sourcePage: SurveySourcePage;
  locale: SurveyLocale;
  visitCount: number;
}

export function parseSurveySubmission(value: unknown): SurveySubmission | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const outcome = body.outcome;
  const sourcePage = body.source_page;
  const locale = body.locale;
  const rawDescription = typeof body.description === "string" ? body.description.trim() : "";
  const visitCount = typeof body.visit_count === "number" && Number.isFinite(body.visit_count)
    ? Math.max(10, Math.min(1_000_000, Math.floor(body.visit_count)))
    : 10;

  if (outcome !== "no_issues" && outcome !== "feedback" && outcome !== "dismissed") return null;
  if (sourcePage !== "dashboard" && sourcePage !== "channel") return null;
  if (locale !== "ko" && locale !== "en") return null;
  if (outcome === "feedback" && !rawDescription) return null;

  return {
    outcome,
    description: outcome === "feedback"
      ? rawDescription.slice(0, SURVEY_DESCRIPTION_MAX_LENGTH)
      : null,
    sourcePage,
    locale,
    visitCount,
  };
}
