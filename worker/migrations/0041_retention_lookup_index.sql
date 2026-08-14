-- Scheduled retention scans actor identities globally by age, not by channel.
CREATE INDEX IF NOT EXISTS message_actor_identities_created_idx
  ON message_actor_identities(created_at);
