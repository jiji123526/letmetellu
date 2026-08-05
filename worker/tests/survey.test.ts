import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseSurveySubmission } from "../src/lib/survey-response.ts";

test("survey feedback requires and bounds a description", () => {
  assert.equal(parseSurveySubmission({
    outcome: "feedback",
    description: "   ",
    source_page: "dashboard",
    locale: "en",
    visit_count: 10,
  }), null);

  const parsed = parseSurveySubmission({
    outcome: "feedback",
    description: `  ${"x".repeat(1_600)}  `,
    source_page: "channel",
    locale: "ko",
    visit_count: 12.8,
  });
  assert.equal(parsed?.description?.length, 1_500);
  assert.equal(parsed?.visitCount, 12);
  assert.equal(parsed?.sourcePage, "channel");
});

test("terminal survey outcomes discard descriptions and normalize visit count", () => {
  assert.deepEqual(parseSurveySubmission({
    outcome: "no_issues",
    description: "should not be stored",
    source_page: "dashboard",
    locale: "en",
    visit_count: 2,
  }), {
    outcome: "no_issues",
    description: null,
    sourcePage: "dashboard",
    locale: "en",
    visitCount: 10,
  });

  assert.equal(parseSurveySubmission({
    outcome: "unknown",
    source_page: "dashboard",
    locale: "en",
  }), null);
});

test("survey response storage is one terminal row per pseudonymous actor", () => {
  const migration = readFileSync(
    new URL("../migrations/0032_visit_survey_responses.sql", import.meta.url),
    "utf8",
  );
  const route = readFileSync(
    new URL("../src/routes/survey.ts", import.meta.url),
    "utf8",
  );
  const workerIndex = readFileSync(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );

  assert.match(migration, /actor_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /CHECK \(outcome IN \('no_issues', 'feedback', 'dismissed'\)\)/);
  assert.match(route, /hashRateLimitIdentifier\("visit-survey-actor"/);
  assert.match(route, /resolveSurveyActor\(request, env, request\.method === "GET"\)/);
  assert.match(route, /identity_required/);
  assert.match(route, /ON CONFLICT\(actor_key\) DO NOTHING/);
  assert.match(workerIndex, /url\.pathname\.startsWith\("\/api\/survey"\)/);
});
