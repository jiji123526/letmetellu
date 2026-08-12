CREATE TABLE cleanup_jobs (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('channel')),
  resource_id TEXT NOT NULL,
  resource_version TEXT NOT NULL,
  media_keys_json TEXT NOT NULL DEFAULT '[]',
  realtime_completed_at TEXT,
  media_completed_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (resource_type, resource_id, resource_version)
);

CREATE INDEX cleanup_jobs_due_idx
  ON cleanup_jobs(completed_at, next_attempt_at);

CREATE INDEX cleanup_jobs_completed_idx
  ON cleanup_jobs(completed_at);
