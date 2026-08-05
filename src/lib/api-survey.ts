export type VisitSurveyOutcome = "no_issues" | "feedback" | "dismissed";
export type VisitSurveySourcePage = "dashboard" | "channel";

export async function fetchVisitSurveyStatus(): Promise<{ responded: boolean }> {
  const response = await fetch("/api/survey", { cache: "no-store" });
  if (!response.ok) throw new Error("survey status failed");
  return response.json();
}

export async function submitVisitSurveyResponse(input: {
  outcome: VisitSurveyOutcome;
  description?: string;
  sourcePage: VisitSurveySourcePage;
  locale: "ko" | "en";
  visitCount: number;
  keepalive?: boolean;
}): Promise<void> {
  const response = await fetch("/api/survey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      outcome: input.outcome,
      description: input.description,
      source_page: input.sourcePage,
      locale: input.locale,
      visit_count: input.visitCount,
    }),
    keepalive: input.keepalive,
  });
  if (!response.ok) throw new Error("survey submission failed");
}
