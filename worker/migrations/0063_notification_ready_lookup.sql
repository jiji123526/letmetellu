-- SQLite cannot prove that the mixed ready/expired-lease OR predicate implies
-- this older three-status partial index, so production probes scanned the
-- entire outbox even when only terminal rows existed.
DROP INDEX IF EXISTS notification_outbox_ready_idx;

CREATE INDEX notification_outbox_attempt_ready_idx
  ON notification_outbox(next_attempt_at, created_at, id)
  WHERE status IN ('pending', 'retry');

CREATE INDEX notification_outbox_lease_ready_idx
  ON notification_outbox(lease_until, created_at, id)
  WHERE status = 'processing';
