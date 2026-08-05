CREATE TABLE IF NOT EXISTS visit_survey_responses (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL UNIQUE,
  outcome TEXT NOT NULL CHECK (outcome IN ('no_issues', 'feedback', 'dismissed')),
  description TEXT,
  source_page TEXT NOT NULL CHECK (source_page IN ('dashboard', 'channel')),
  locale TEXT NOT NULL CHECK (locale IN ('ko', 'en')),
  visit_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS visit_survey_responses_created_idx
  ON visit_survey_responses(created_at DESC);

CREATE INDEX IF NOT EXISTS visit_survey_responses_outcome_created_idx
  ON visit_survey_responses(outcome, created_at DESC);
