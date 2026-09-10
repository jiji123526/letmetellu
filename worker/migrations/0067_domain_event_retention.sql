CREATE INDEX domain_events_delivered_updated_idx
  ON domain_events(updated_at)
  WHERE status = 'delivered';

CREATE INDEX domain_events_dead_updated_idx
  ON domain_events(updated_at)
  WHERE status = 'dead';
