ALTER TABLE billing_webhook_events
  ADD COLUMN processing_started_at TEXT;

ALTER TABLE billing_webhook_events
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS billing_webhook_events_processing_idx
  ON billing_webhook_events(status, processing_started_at);
